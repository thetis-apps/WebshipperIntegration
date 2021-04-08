/**
 * Copyright 2021 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const axios = require('axios');

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
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
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
	if (subject == 'order/deleted' || status == 'pending' || status == 'cancelled') {
	    
        let params = {
            MessageAttributes: {
                "subject": {
                  DataType: "String",
                  StringValue: subject
                }
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
    
    let baseUrl = 'https://' + serverName + '.api.webshipper.io/v2/';
    
    console.log(baseUrl);
    
    let webshipper = axios.create({
    		baseURL: baseUrl, 
    		headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/vnd.api+json" }
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

function getInstanceSpecification(instance) {
	let specification = "";
	specification = instance.batchNumber != null ? specification.concat(" Batch: " + instance.batchNumber) : specification;
	specification = instance.serialNumber != null ? specification.concat(" Serial: " + instance.serialNumber) : specification;
	specification = instance.expirationDate != null ? specification.concat(" Expiration: " + instance.expirationDate) : specification;
	specification = instance.bestBeforeDate != null ? specification.concat(" Best before: " + instance.bestBeforeDate) : specification;
	return specification;
}

function setAddress(webshipperAddress, address) {
 	address.addressee = webshipperAddress.company_name;
	address.careOf = webshipperAddress.att_contact;
	address.streetNameAndNumber = webshipperAddress.address_1;
	address.districtOrCityArea = webshipperAddress.address_2;
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

function getWebshipperAddress(address, contactPerson) {
	let webshipperAddress = new Object();
 	webshipperAddress.company_name = address.addressee;
	webshipperAddress.att_contact = address.careOf;
	webshipperAddress.address_1 = address.streetNameAndNumber;
	webshipperAddress.address_2 = address.districtOrCityArea;
	webshipperAddress.city = address.cityTownOrVillage;
	webshipperAddress.state = address.stateOrProvince;
	webshipperAddress.country_code = address.countryCode;
	webshipperAddress.zip = address.postalCode;
	webshipperAddress.email = contactPerson.email;
	webshipperAddress.phone = contactPerson.mobileNumber;
	webshipperAddress.phone = contactPerson.phoneNumber;
	webshipperAddress.att_contact = contactPerson.name;
	return webshipperAddress;
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
		shipmentLine.sellersReference = orderLine.id;
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
	patch.deliveryAddress_addressee = attributes.delivery_address.company_name;
	patch.deliveryAddress_careOf = attributes.delivery_address.att_contact;
	patch.deliveryAddress_streetNameAndNumber = attributes.delivery_address.address_1;
	patch.deliveryAddress_districtOrCityArea = attributes.delivery_address.address_2;
	patch.deliveryAddress_cityTownOrVillage = attributes.delivery_address.city;
	patch.deliveryAddress_stateOrProvince = attributes.delivery_address.state;
	patch.deliveryAddress_countryCode = attributes.delivery_address.country_code;
	patch.deliveryAddress_postalCode = attributes.delivery_address.zip;
	patch.contactPerson_email = attributes.delivery_address.email;
	patch.contactPerson_mobileNumber = attributes.delivery_address.phone;
	patch.contactPerson_phoneNumber = attributes.delivery_address.phone;
	patch.contactPerson_name = attributes.delivery_address.att_contact;
	patch.notesOnDelivery = attributes.external_comment ;
	patch.notesOnPacking = attributes.internal_comment ;
	patch.notesOnShipping = shippingRate.data.attributes.name;
	patch.deliverToPickUpPoint = deliverToPickUpPoint;
	patch.pickUpPointId =pickUpPointId;
	patch.onHold = attributes.lock_state != null && attributes.lock_state == 'locked';
	patch.cancelled = attributes.status == 'cancelled';
	
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
	attributes.error_message = message.messageText;
	attributes.error_class = message.messageCode;
	
	console.log("Patching after error");
	
	await ws.patch("/orders/" + order.data.id, patch);
}

exports.handleOrder = async (event, context) => {
    
    console.log(JSON.stringify(event));
    
    for (let i = 0; i < event.Records.length; i++) {

        let message = event.Records[i];
    	let contextId = message.attributes.MessageGroupId;
    	let subject = message.messageAttributes.subject.stringValue;
    	
        let ims = await getIMS(contextId);
    
        let setup = await getSetup(ims, contextId);

    	let ws = await getWebshipper(setup.serverName, setup.apiKey);

    	let order = JSON.parse(message.body);
    	
		let sellerNumber = order.data.attributes.order_channel_id;
	
		// Find all shipments that are related to this order

        let filter = new Object();    		    
		filter.sellerNumberMatch = sellerNumber;
		filter.sellersReferenceMatch = order.data.id;
		let response = await ims.get("shipments", { params: filter });
		let shipments = response.data;

    	if (subject == 'order/deleted') {
    		
    		// If order deleted we cancel all shipment that have not yet been packed
    		
    		for (let i = 0; i < shipments.length; i++) {
    			let shipment = shipments[i];
    			if (shipment.deliveryNoteId == null && !shipment.cancelled) {
    				await ims.put("shipments/" + shipment.id + "/cancelled", "true");
    			}
    		}
    			
    	} else {
    		
	    	let response = await ws.get("orders/" + order.data.id);
	    	order = response.data;
	    	
	    	response = await ws.get(order.data.relationships.shipping_rate.links.related, { baseUrl: "" });
	        let shippingRate = response.data;	

			if (shipments.length == 0) {
			    
			    // No shipment related to this order yet - so we create a shipment
			    
				await createShipment(ims, ws, order, shippingRate);
	
			} else {
			    
			    // We already have one or more shipments related to this order - so update all shipments without delivery note
			    
			    for (let i = 0; i < shipments.length; i++) {
			        let shipment = shipments[i];
			        if (shipment.deliveryNoteId == null) {
				        await updateShipment(ims, ws, shipment, order, shippingRate);
			        } 
			    }
			    
			}
			
		}
    }
    
    return null;         
};

/**
 * Prepare the order for shipping of packed item instances.
 * 
 * This function is (and must be) idempotent. 
 * 
 * Returns the response from the invocation of the patch method.
 */
async function patchOrder(ws, order, shipment, instances) {
		
	// Make a map of SKU on packed item instances

    var instanceMap = new Map();
	for (let i = 0; i < instances.length; i++) {
		let instance = instances[i];
		let instancesWithThisSku = [];
		if (instanceMap.has(instance.stockKeepingUnit)) {
			instancesWithThisSku = instanceMap.get(instance.stockKeepingUnit);
		}
		instancesWithThisSku.push(instance);
		instanceMap.set(instance.stockKeepingUnit, instancesWithThisSku)
	}
	
	// Make a map of SKU on order lines

	var orderLineMap = new Map();
	for (let i = 0; i < order.data.attributes.order_lines.length; i++) {
		let orderLine = order.data.attributes.order_lines[i];
		if (orderLine.package_id == null) {
			let orderLinesWithThisSku = [];
			if (orderLineMap.has(orderLine.sku)) {
				orderLinesWithThisSku = orderLineMap.get(orderLine.sku);			
			}
			orderLinesWithThisSku.push(orderLine);
			orderLineMap.set(orderLine.sku, orderLinesWithThisSku);
		}
	}

	// Reconcile packed instances against order lines

	let newOrderLines = [];
	
	instanceMap.forEach(function(instances, sku) {
		for (let i = 0; i < instances.length; i++) {
			let instance = instances[i];
			let remaining = instance.instanceCount;
			if (orderLineMap.has(sku)) {
				let orderLines = orderLineMap.get(sku);
				let j = 0;
				while (remaining > 0 && j < orderLines.length) {
					let oldOrderLine = orderLines[j];	
					if (oldOrderLine.quantity > 0) {
						let newOrderLine = new Object();
						if (remaining < oldOrderLine.quantity) {
							newOrderLine.quantity = remaining;
							oldOrderLine.quantity = oldOrderLine.quantity - remaining;
							remaining = 0;
						} else {
							newOrderLine.quantity = oldOrderLine.quantity;
							remaining = remaining - oldOrderLine.quantity;
							oldOrderLine.quantity = 0;
						}	
						newOrderLine.sku = instance.stockKeepingUnit;
						newOrderLine.country_of_origin = oldOrderLine.country_of_origin;
						newOrderLine.ext_ref = oldOrderLine.ext_ref;
						let description = oldOrderLine.description;
						let instanceDescription = getInstanceSpecification(instance);
						if (instanceDescription.length > 0) {
							description = description + " ||" + instanceDescription;
						}
						newOrderLine.description = description;
						newOrderLine.location = instance.shippingContainerId.toString();
						newOrderLine.tarif_number = oldOrderLine.tarif_number;
						newOrderLine.country_of_origin = oldOrderLine.country_of_origin;
						newOrderLine.unit_price = oldOrderLine.unit_price;
						newOrderLine.discounted_unit_price = oldOrderLine.discounted_unit_price;
						newOrderLine.discount_value = oldOrderLine.discount_value;
						newOrderLine.discount_type = oldOrderLine.discount_type;
						newOrderLine.vat_percent = oldOrderLine.vat_percent;
						newOrderLine.weight = oldOrderLine.weight;
						newOrderLine.weight_unit = oldOrderLine.weight_unit;
						newOrderLine.order_id = oldOrderLine.order_id;
						newOrderLine.is_virtual = oldOrderLine.is_virtual;
						newOrderLines.push(newOrderLine);					
					}
					j++;
				}
			}
			if (remaining > 0) {
				throw new Error("Could not fully reconcile instance with id: " + instance.id + " (" + instance.stockKeepingUnit + " / " + instance.instanceCount + ")");
			}
		}		
	});	
	
	console.log(JSON.stringify(newOrderLines));
	
	// Push old order lines with a left over quantity onto the list of new order lines
	
	orderLineMap.forEach(function(orderLines, sku) {
		for (let i = 0; i < orderLines.length; i++) {
			let orderLine = orderLines[i];
			if (orderLine.quantity > 0) {
				newOrderLines.push(orderLine);
			}
		}	
	});
	
	// Now patch the order with the new list of order lines and with delivery information (address, drop-point).
	// Changing the delivery information at this point allows the warehouse worker to correct 
	// errors blocking for the creation of labels.
	
	let patch = new Object();
	let data = new Object();
	data.id = order.data.id;
	data.type = "orders";
	patch.data = data;
	let attributes = new Object();
	attributes.order_lines = newOrderLines;
	attributes.delivery_address = getWebshipperAddress(shipment.deliveryAddress, shipment.contactPerson);
    let dropPoint = new Object();
    dropPoint.drop_point_id = shipment.pickUpPointId;
    attributes.drop_point = dropPoint;
	data.attributes = attributes;
	
	return await ws.patch("orders/" + order.data.id, patch);

}

/**
 * Creates a Webshipper shipment.
 * 
 * Returns the response from the invocation of the post method.
 * 
 */
async function postShipment(ws, order, shipment, instances) {
	
	// Iterate over shipping containers to create a list of packages

	let orderLines = order.data.attributes.order_lines;
    let packages = [];
    let shippingContainers = shipment.shippingContainers;
    for (let i = 0; i < shippingContainers.length; i++) {
		let shippingContainer = shippingContainers[i];
		let package = new Object();

	    package.weight = shippingContainer.grossWeight;
	    package.weight_unit = 'kg';
	    package.dimensions = shippingContainer.dimensions;

	    // Order lines
	
		package.order_lines = [];
		for (let j = 0; j < orderLines.length; j++) {
			let orderLine = orderLines[j];
			if (orderLine.location == shippingContainer.id.toString()) {
				package.order_lines.push(orderLine);
			}
		}

	    packages.push(package);
    }
    
    // Create a new Webshipper shipment

    var webshipperShipment = new Object();
    let data = new Object();
    data.type = "shipments";
    let attributes = new Object();
    let relationships = new Object();
    data.attributes = attributes;
    webshipperShipment.data = data;
    data.relationships = relationships;

	// State relationship to order

	let orderLink = new Object();
	let orderLinkData = new Object();
	orderLinkData.type = "orders";
	orderLinkData.id = order.data.id;
	orderLink.data = orderLinkData;
	relationships.order = orderLink;

	// Shipment

    attributes.reference = shipment.shipmentNumber;
    attributes.comment = shipment.notesOnDelivery;
    attributes.fulfill_immediately = true;
    attributes.test_mode = false;

    attributes.packages = packages;

 	return await ws.post("shipments", webshipperShipment, { validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 422; // default
		}});
	
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
        	
    let response = await ims.get("shipments/" + detail.shipmentId);
	let shipment = response.data;
	
    response = await ims.get("shipments/" + detail.shipmentId + "/globalTradeItemInstances");
	let instances = response.data;

	response = await ws.get("orders/" + shipment.sellersReference);
	let order = response.data;

	response = await patchOrder(ws, order, shipment, instances);
	order = response.data;

	response = await postShipment(ws, order, shipment, instances);

	if (response.status == 422) {
		let errors = response.data.errors;
    	for (let i = 0; i < errors.length; i++) {
    		let error =  errors[i];
    		let message = new Object();
    		message.time = Date.now();
    		message.source = "WebshipperIntegration";
    		message.messageType = "ERROR";
    		message.messageText = error.title + ": " + error.detail;
    		await ims.post("events/" + detail.eventId + "/messages", message);
    	}
    	
	} else {
		
		let webshipperShipment = response.data;
		
		// Attach shipping labels to IMS shipment
		
		response = await ws.get(webshipperShipment.data.relationships.labels.links.related, { baseUrl: "" });
		let labels = response.data.data;
		for (let i = 0; i < labels.length; i++) {
			let label = labels[i];
			let shippingLabel = new Object();
			shippingLabel.base64EncodedContent = label.attributes.base64;
			shippingLabel.fileName = "SHIPPING_LABEL_" + shipment.id + "_" + (i + 1) + ".pdf";
			await ims.post("shipments/" + shipment.id + "/attachments", shippingLabel);
		}
		
		// Attach labels for all return shipments to IMS shipment
		
		response = await ws.get(webshipperShipment.data.relationships.return_shipments.links.related, { baseUrl: "" });
		let returnShipments = response.data.data;
		for (let i = 0; i < returnShipments.length; i++) {
		    let returnShipment = returnShipments[i];
	    	response = await ws.get(returnShipment.relationships.labels.links.related, { baseUrl: "" });
			labels = response.data.data;
	    	for (let j = 0; i < labels.length; j++) {
		    	let label = labels[j];
				let shippingLabel = new Object();
				shippingLabel.base64EncodedContent = label.attributes.getBase64;
				shippingLabel.fileName = "RETURN_LABEL_" + shipment.id + "_" + (i + 1) + "_" + (j + 1) + ".pdf";
				await ims.post("shipments/" + shipment.id + "/attachments", shippingLabel);
			}
		}
	
	    // Update IMS shipment with tracking number etc.
	    
		let shippingContainers = shipment.shippingContainers;
		let trackingLinks = webshipperShipment.data.attributes.tracking_links;
		for (let i = 0; i < trackingLinks.length; i++) {
		    let trackingLink = trackingLinks[i];
		    let shippingContainer = shippingContainers[i];
		    await ims.put("shippingContainers/" + shippingContainer.id + "/trackingNumber", JSON.stringify(trackingLink.number));
		    await ims.put("shippingContainers/" + shippingContainer.id + "/trackingUrl", JSON.stringify(trackingLink.url));
		}
		
		await ims.put("shipments/" + shipment.id + "/consignmentId", JSON.stringify(webshipperShipment.data.id.toString()));
		
		// Send a message to signal that we are done
		
		let message = new Object();
		message.time = Date.now();
		message.source = "WebshipperIntegration";
		message.messageType = "INFO";
		message.messageText = "Labels are ready";
		await ims.post("events/" + detail.eventId + "/messages", message);
		
	}
};


