![alpha](https://img.shields.io/badge/Status-Alpha-yellow.svg)

<p align="center">
  <img src="https://github.com/openintegrationhub/openintegrationhub/blob/master/Assets/medium-oih-einzeilig-zentriert.jpg" alt="Sublime's custom image" width="400"/>
</p>

The revolution in data synchronization — the Open Integration Hub enables simple data synchronization between any software applications and thus accelerates digitalisation

Visit the official [Open Integration Hub homepage](https://www.openintegrationhub.de/)

# Governance Service (working title / Codename Thoth)

The Governance Service serves as the central repository for all data governance-related data and functions inside the OIH. It offers both a database for long-term storage of relevant data as well as an API for data retrieval and validation.

## Functions

### Data Provenance
The "Data Provenance" function of the Governance Repository is intended to allow users to reconstruct their data's path through the OIH from the very first time it was synchronized up until the current moment. This way, the data owner will be able to track all origins and destinations of their data, and whether it has been modified inside the OIH. This way, the data owner will be made more capable of complying with data governance policies and laws, such as the GDPR.

To this end, the Governance Service is capable of receiving metadata about certain events, such as a data object being transmitted from one application to another, and stores it as a detailed data provenance event. These events can then be retrieved, filtered, and searched using the Service's API.

#### Provenance data model
The used data model is based on [PROV-DM](https://www.w3.org/TR/prov-dm/). This allows for easy mapping and export of provenance data to other systems. The model describes tuples of entities, agents, and activities, in addition to optional situational fields, such as describing one agent acting on behalf of another.

Example provenance object:
```json
{
  "entity": {
    "oihUid": "aoveu03dv921dvo",
    "domain": "Addresses",
    "schema": "Person",
    "records": [
      {
        "application": "Google",
        "recordUid": "abcde"
      },
      {
        "application": "Wice",
        "recordUid": 12345
      }
    ]
  },
  "activity": {
    "action": "ObjectReceived",
    "function": "getPersons",
    "flowId": "30j0hew9kwbnkksfb09",
    "prov:startTime": "2020-10-19T09:47:11+00:00",
    "prov:endTime": "2020-10-19T09:47:15+00:00",
    "protocol": "The object was successfully inserted"
  },
  "agent": {
    "kind": "Component",
    "id": "w4298jb9q74z4dmjuo",
    "name": "Google Connector"
  },
  "actedOnBehalfOf": {
    "prov:delegate": { "kind": "Component", "id": "w4298jb9q74z4dmjuo"},
    "prov:responsible": { "kind": "User", "id": "j460ge49qh3rusfuoh"}
  }
}
```

## Technical description

Thoth uses MongoDB for archiving the integration flows. You will need a MongoDB
and change the path in the deployment.yaml. We use Mongoose for object modeling. Mongoose is built on top of the official MongoDB Node.js driver.

For documenting the API Thoth uses the SwaggerUI.

## Local installation/development

### Without Docker

- Ensure a local MongoDB Database is running
- Run `npm install` to install dependencies. If dependencies are still reported missing, run `npm install` within the /app/iam-utils/ folder as well
- If using the IAM middleware/features, set the environment variable `INTROSPECT_ENDPOINT_BASIC` to match the respective endpoint used by your used IAM instance.
- Run `npm start`


## REST-API documentation

Visit http://governance-service.openintegrationhub.com/api-docs/ to view the Swagger API-Documentation