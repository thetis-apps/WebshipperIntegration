#Description

This application establishes an integration between Webshipper and Thetis IMS. In this integration Webshipper is
seen as an order management system and Thetis IMS as a system for the fulfillment of orders. 

The application supports partial fullfilment.

The application enriches Webshipper orders with information about the items shipped.

##Prerequisites

- All Thetis IMS shipments relevant to the application are created by the application itself.
- Only orders with status 'pending' are relevant for fulfillment.

##Events

###Order created or updated

If the status of the order is not 'pending' the event is ignored.  

Delivery information is updated.

###Order deleted 

All Thetis IMS shipments with relation to the deleted order are cancelled, if they have not already been packed (delivery note exists).

###Request for shipping labels

####Preparing order for shipping

- Splitting order lines according to packed instances
- Updating delivery information.

####Creating Webshipper shipment

####Updating Thetis IMS





