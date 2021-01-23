
const axios = require('axios');

const querystring = require('querystring');

var AWS = require('aws-sdk');
AWS.config.update({region:'eu-west-1'});


async function getIMS(contextId) {

    const authUrl = "https://auth.thetis-ims.com/oauth2/";
    const apiUrl = "https://api.thetis-ims.com/2/";

	let clientId = process.env.ClientId;
	let clientSecret = process.env.ClientSecret;  
	let apiKey = process.env.ApiKey;  

    let credentials = clientId + ":" + clientSecret;
	let base64data = Buffer.from(credentials, 'UTF-8').toString('base64');	
	
	let imsAuth = axios.create({
			baseURL: authUrl,
			headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
			responseType: 'json'
		});

    let response = await imsAuth.post("token", 'grant_type=client_credentials');
    let token = response.data.token_type + " " + response.data.access_token;
    
    let ims = axios.create({
    		baseURL: apiUrl,
    		headers: { "Authorization": token, "x-api-key": apiKey}
    	});
	
	ims.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});
		
    return ims;
}

async function getSetup(ims, contextId) {
    let response = await ims.get("contexts/" + contextId);
    let context = response.data;
    let dataDocument = JSON.parse(context.dataDocument);
    let setup = dataDocument.WebshipperIntegration;
    return setup;
}


exports.handleWebhook = async (input, x) => {

    let orderQueue = process.env.OrderQueue;

//    console.info(JSON.stringify(input));
    
	let contextId = input.pathParameters.contextId;

    // Create IMS client

    let ims = await getIMS(contextId);

    // Get setup from IMS
    
    let setup = await getSetup(ims, contextId);
    if (setup == null) {
    	return "No configuration for context " + contextId;
    }
	
	// Validate received data according to web hook secret

	let webhookSecret = setup.webhookSecret;
	let data = input.body;
	let encodedToken = input.headers['X-Webshipper-Hmac-Sha256'];
	let subject = input.headers['X-Webshipper-Topic'];

	// Now validate - POSTPONED !!!!

    /*
    let secretKeySpec = new SecretKeySpec(key.getBytes(), "HmacSHA256");
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(secretKeySpec);
    byte[] hmac = mac.doFinal(data.getBytes());
    byte[] base64encodedHmac = Base64.encodeBase64(hmac);
	String base64encodedHmacString = new String(base64encodedHmac);
	if (!base64encodedHmacString.equals(encodedToken)) {
		throw new RuntimeException(base64encodedHmacString + " v. " + encodedToken);
	}
	*/

    // Queue order if status is pending or error

    let sqs = new AWS.SQS();

	let order = JSON.parse(data);
	let status = order.data.attributes.status;
	if (status == "pending") {
	    
        let params = {
            MessageAttributes: {
                "contextId": {
                  DataType: "String",
                  StringValue: contextId
                },
                "subject": {
                  DataType: "String",
                  StringValue: subject
                },
            },
            MessageBody: JSON.stringify(order),
            MessageDeduplicationId: input.requestContext.requestId,
            MessageGroupId: contextId,
            QueueUrl: orderQueue
        };

        await sqs.sendMessage(params).promise();
    	
	} else {
		console.log("Skipping due to status: " + status);
	}
	
	let output = new Object();
    output.statusCode = 200;
	return output;
};

async function getWebshipper(serverName, apiKey) {
    
    let baseUrl = 'https://' + serverName + '.api.webshipper.io/';
    
    console.log(baseUrl);
    
    let webshipper = axios.create({
    		baseURL: baseUrl, 
    		headers: { "Authorization": "Bearer " + apiKey }
    	});
    	
    webshipper.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

	
    return webshipper;
}

function setAddress(webshipperAddress, address) {
 	address.addressee = webshipperAddress.companyName;
	address.careOf = webshipperAddress.att_contact;
	address.streetNameAndNumber = webshipperAddress.address1;
	address.districtOrCityArea = webshipperAddress.address2;
	address.cityTownOrVillage = webshipperAddress.city;
	address.stateOrProvince = webshipperAddress.state;
	address.countryCode = webshipperAddress.country_code;
	address.postalCode = webshipperAddress.zip;
}

function setContactPerson(webshipperAddress, contactPerson) {
	contactPerson.email = webshipperAddress.email;
	contactPerson.mobileNumber = webshipperAddress.phone;
	contactPerson.phoneNumber = webshipperAddress.phone;
	contactPerson.name = webshipperAddress.att_contact;
}

async function createShipment(ims, ws, order, shippingRate) {
    
    let attributes = order.data.attributes;

	// Customer number is billing address email
	
	let billingAddress = attributes.billing_address;
	let customerNumber = billingAddress.email != null ? billingAddress.email : "No email";
	
	// Create customer if not extant
	
	let customer = new Object();
	let filter = new Object();
	filter.customerNumberMatch = customerNumber;
	let response = await ims.get("customers", { params: filter });
	let customers = response.data;
	if (customers.length == 0) {
		customer.customerNumber = customerNumber;  
		customer.vatNumber = billingAddress.vat_no;
		customer.requiresTrackAndTrace = true;
		customer.address = new Object();
		setAddress(billingAddress, customer.address);
		customer.contactPerson = new Object();
		setContactPerson(billingAddress, customer.contactPerson);
		response = await ims.post("customers", customer);
		customer = response.data;
	} else {
		customer = customers[0];
	}
	
	let shipment = new Object();
	shipment.customerId = customer.id;
	shipment.shipmentNumber =  attributes.visible_ref;
	shipment.sellersReference = order.data.id;
	shipment.termsOfDelivery = "Webshipper";
	shipment.deliveryDate = Date.now();
	shipment.shippingDeadline = Date.now();
	shipment.sellerNumber = attributes.order_channel_id;
	shipment.currencyCode = attributes.currency;
	shipment.deliveryAddress = new Object();
	setAddress(attributes.delivery_address, shipment.deliveryAddress);
	shipment.contactPerson = new Object();
	setContactPerson(attributes.delivery_address, shipment.contactPerson);
	
	let dropPoint = attributes.drop_point;
	if (dropPoint != null) {
		shipment.deliverToPickUpPoint = true;
		shipment.pickUpPointId = dropPoint.drop_point_Id;
	}
	
	shipment.setNotesOnDelivery = attributes.external_comment;
	shipment.setNotesOnPacking = attributes.internal_comment;
	shipment.setNotesOnShipping = shippingRate.data.attributes.name;
	
	shipment.shipmentLines = [];
	let orderLines = attributes.order_lines;
	
	for (let i = 0; i < orderLines.length; i++) {
	    let orderLine = orderLines[i];
		let shipmentLine = new Object();
		shipmentLine.numItemsOrdered = orderLine.quantity;
		shipmentLine.salesPrice = orderLine.unit_price;
		shipmentLine.notesOnPicking = orderLine.description;
		shipmentLine.sellersReference = orderLine.id;
		shipmentLine.stockKeepingUnit = orderLine.sku;
		shipment.shipmentLines.push(shipmentLine);
	}

	shipment.onHold = attributes.lock_state != null && attributes.lock_state == "locked";
	
	response = await ims.post("shipments", shipment, { validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 422; // default
		}});

	if (response.status == 422) {
		await errOrder(ws, order, response.data);
	}
	
}

async function updateShipment(ims, ws, shipment, order, shippingRate) {

    let attributes = order.data.attributes;

	let deliverToPickUpPoint;
	let pickUpPointId;
	let dropPoint = attributes.drop_point;
	if (dropPoint != null) {
		deliverToPickUpPoint = true;
		pickUpPointId = dropPoint.drop_point_id;
	} else {
		deliverToPickUpPoint = false;
		pickUpPointId = null;
	}
		
	let patch = new Object();
	patch.currencyCode = attributes.currency;
	patch.deliveryAddress = new Object();
	setAddress(attributes.delivery_address, patch.deliveryAddress);
	patch.contactPerson = new Object();
	setContactPerson(attributes.delivery_address, patch.contactPerson);
	patch.notesOnDelivery = attributes.external_comment ;
	patch.notesOnPacking = attributes.internal_comment ;
	patch.notesOnShipping = shippingRate.data.attributes.name;
	patch.deliverToPickUpPoint = deliverToPickUpPoint;
	patch.pickUpPointId =pickUpPointId;
	patch.onHold = attributes.lock_state != null && attributes.lock_state == "locked";
	
	console.log("ShipmentId: " + shipment.id + " Patch: " + JSON.stringify(patch));
	
	let response = await ims.patch("shipments/" + shipment.id, patch, { validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 422; // default
		}});
	
	
	if (response.status == 422) {
		await errOrder(ws, order, response.data);
	}

}

async function errOrder(ws, order, message) {
	let patch = new Object();
	let orderData = new Object();
	orderData.id = order.data.id;
	orderData.type = "orders";
	patch.data = orderData;
	let attributes = new Object();
	orderData.attributes = attributes;
	attributes.status = "error";
	attributes.errorMessage = message.messageText;
	attributes.errorClass = message.messageCode;
	await ws.patch("/orders/" + order.data.id, patch);
}

exports.handleOrder = async (event, context) => {
    
    console.log(JSON.stringify(event));
    
    for (let i = 0; i < event.Records.length; i++) {

        let message = event.Records[i];
        
    	let contextId = message.attributes.MessageGroupId;
    
        let ims = await getIMS(contextId);
    
        let setup = await getSetup(ims, contextId);

    	let ws = await getWebshipper(setup.serverName, setup.apiKey);

//    	console.log(message.body);
    
    	let order = JSON.parse(message.body);
    	
    	let response = await ws.get(order.data.relationships.shipping_rate.links.related);
        let shippingRate = response.data;	
        	
		let sellerNumber = order.data.attributes.order_channel_id;

        let filter = new Object();    		    
		filter.sellerNumberMatch = sellerNumber;
		filter.sellersReferenceMatch = order.data.id;
		response = await ims.get("shipments", { params: filter });
		let shipments = response.data;
		
		if (shipments.length == 0) {
		    
		    // No shipment related to this order yet - so we create a shipment
		    
			await createShipment(ims, ws, order, shippingRate);

		} else {
		    
		    // We already have one or more shipments related to this order - so update all shipments !?
		    
		    for (let i = 0; i < shipments.length; i++) {
		        let shipment = shipments[i];
		        await updateShipment(ims, ws, shipment, order, shippingRate);
		    }
		    
		}
		
	}

    return null;         
};

function createWebshipperShipment(order, shipment) {
    
    // So this is where it get insteresting
    
}

exports.handleShippingLabelRequest = async (event, x) => {
    
    let detail = event.detail;
    let contextId = detail.contextId;
			
    let ims = await getIMS(contextId);
    
    // Get setup from IMS 

    let setup = await getSetup(ims, contextId);
    if (setup == null) {
    	return "No configuration for context " + contextId;
    }

	let ws = await getWebshipper(setup.serverName, setup.apiKey);
        	
    let shipment = ims.get("shipments/" + detail.shipmentId);
	    		
	// Adjust og delete lines that have been changed or deleted in Thetis IMS

	let response = await ws.get("orders/" + shipment.getSellersReference());
	let order = response.data;

	// Create a Webshipper shipment
	
	let webshipperShipment = createWebshipperShipment(order, shipment);
	response = await ws.post("shipments", webshipperShipment, { validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 422; // default
		}});
	
	if (response.status == 422) {
		let errors = response.data.errors;
    	for (let i = 0; i < errors.length; i++) {
    		let error =  errors[0];
    		let message = new Object();
    		message.time = Date.now;
    		message.source = "WebshipperIntegration";
    		message.messageType = "ERROR";
    		message.messageText = error.title+ ": " + error.detail;
    		ims.post("events", detail.eventId, "messages", message);
    	}
    	
	} else {
		
		webshipperShipment = response.data;
		
		// Attach shipping labels to IMS shipment
		
		response = await ws.get(webshipperShipment.data.relationships.labels.links);
		let labels = response.data.data;
		for (let i = 0; i < labels.length; i++) {
			let label = labels[i];
			let shippingLabel = new Object();
			shippingLabel.setBase64EncodedContent = label.attributes.base64;
			shippingLabel.setFileName = "SHIPPING_LABEL_" + shipment.getId() + "_" + (i + 1) + ".pdf";
			ims.post("shipments/" + shipment.id + "/attachments", shippingLabel);
		}
		
		// Attach labels for all return shipments to IMS shipment
		
		response = await ws.get(webshipperShipment.data.relationships.returnShipments.links);
		let returnShipments = response.data.data;
		for (let i = 0; i < returnShipments.length; i++) {
		    let returnShipment = returnShipments[i];
	    	response = await ws.get(returnShipment.relationships.labels.links);
			labels = response.data.data;
	    	for (let j = 0; i < labels.length; j++) {
		    	let label = labels[j];
				let shippingLabel = new Object();
				shippingLabel.setBase64EncodedContent = label.attributes.getBase64;
				shippingLabel.setFileName = "RETURN_LABEL_" + shipment.id + "_" + (i + 1) + "_" + (j + 1) + ".pdf";
				ims.post("shipments/" + shipment.id + "/attachments", shippingLabel);
			}
		}
	
	    // Update IMS shipment with tracking number etc.
	    
		let shippingContainers = shipment.shippingContainers;
		let trackingLinks = webshipperShipment.data.attributes.trackingLinks;
		for (let i = 0; i < trackingLinks.length; i++) {
		    let trackingLink = trackingLinks[i];
		    let shippingContainer = shippingContainers[i];
		    await ims.put("shippingContainers/" + shippingContainer.id + "/trackingNumber", trackingLink.number);
		    await ims.put("shippingContainers/" + shippingContainer.id + "/trackingUrl", trackingLink.url);
		}
		await ims.put("shipments/" + shipment.id + "/consignmentId", webshipperShipment.data.id);
		
		// Send a message to signal that we are done
		
		let message = new Object();
		message.time = Date.now();
		message.source = "WebshipperIntegration";
		message.messageType = "INFO";
		message.messageText = "Labels are ready";
		ims.post("events/" + detail.getEventId() + "/messages", message);
	}
};

