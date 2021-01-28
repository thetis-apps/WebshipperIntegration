# Description

This application establishes an integration between Webshipper and Thetis IMS. In this integration Webshipper is
seen as an order management system and Thetis IMS as a system for the fulfillment of orders. 

- The application supports partial fullfilment. 
- The application supports the packing of items into more shipping containers (packages in Webshipper terminology).
- The application enriches Webshipper orders with information about the items shipped. 

The above mentioned features are achieved by splitting the order lines according to how the 
items for the lines were packed. You should be aware that this splitting of order lines always happens, and that the specific 
splitting depends on how the items were packed. Broadly speaking each scanning in the warehouse will result in a split.

The following information is added to order lines:

- Batch number
- Serial number
- Expiration date
- Best before date

One order may be related to more Thetis IMS shipments. The relation is established by means of the 'Sellers Reference' field. 
All shipments related to the same order have the same value in the 'Sellers Reference' field - namely the id of the order. 

The Thetis IMS shipments created from orders are given the value of the 'Visible ref' field as their number. Later shipments for the 
same order must be created in Thetis IMS with the appropriate value set in the 'Sellers Reference' field.

# Installation

## Application settings

- Application name
- ClientId 
- ClientSecret
- ApiKey 
- ContextId
- DevOpsEmail

## Output

- URL to use for webhook as shown as 'API Endpoint' once the application has been installed.

# Configuration

In the data document of the context:

```
{
  "WebshipperIntegration": {
    "apiKey": "52100712f5e92d838779a74fa32da2ba34059fc4057b113ed91f035c3c0d5f51",
    "serverName": "thetis-pack",
    "webhookSecret": "asdfadfasdasdfiouosguah"
  }
}
```

# Events

## Order created or updated

If the status of the order is not 'pending' the event is ignored.  

If one or more Thetis IMS shipments exist with relation to the order (as determined by the value of the 'Sellers Reference' field of the shipment), the delivery information of the order is updated. If no shipment exists, a shipment is created. 

If for some reason it is not possible to create or update a shipment, the application changes the status of the order to 'error'.  

By delivery information we mean delivery address and pick up point.

## Order deleted 

All Thetis IMS shipments with relation to the deleted order are cancelled, if they have not already been packed (delivery note exists).

## Request for shipping labels

When Thetis IMS requests shipping labels the application goes throught three steps.

### Preparing order for shipping

In this step the application:

- Split order lines according to packed instances
- Updates delivery information of the order from the Thetis IMS shipment. This allows the warehouse workers to make last minute changes to the delivery information from within Thetis IMS. This may be necessary to make the shipment pass the carriers validation.

### Creating Webshipper shipment

In this step the application:

- Creates a Webshipper shipment that references only those order lines that have been packed. 

### Updating Thetis IMS

In this step the application:

- Setting tracking number on shipping containers
- Attaching shipping labels to Thetis IMS shipment
- Attaching shipping labels related to return shipments to Thetis IMS shipment
- Setting the 'Consignment id' field of the Thetis IMS shipment to the id of the Webshipper shipment
- Sends a signal to let Thetis IMS know that the labels are ready.





