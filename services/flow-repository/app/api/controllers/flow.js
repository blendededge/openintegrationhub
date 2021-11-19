/* eslint no-underscore-dangle: "off" */
/* eslint max-len: "off" */
/* eslint func-names: "off" */
/* eslint consistent-return: "off" */

// const path = require('path');
// const _ = require('lodash');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const { URL } = require('url');
const path = require('path');
const { can } = require('@openintegrationhub/iam-utils');
const config = require('../../config/index');
const { publishQueue } = require('../../utils/eventBus');
const { validate } = require('../../utils/validator');

const storage = require(`./${config.storage}`); // eslint-disable-line

const jsonParser = bodyParser.json();
// const urlParser = bodyParser.urlencoded({ extended: false });
const router = express.Router();

const log = require('../../config/logger'); // eslint-disable-line

// require our MongoDB-Model
const Flow = require('../../models/flow');

// Gets all flows
router.get('/', jsonParser, can(config.flowReadPermission), async (req, res) => {
  let error = false;

  let pageSize = 10;
  let pageNumber = 1;

  const filters = {};
  const filterTypes = { ordinary: 1, long_running: 1 };

  let searchString = '';

  const sortableFields = { createdAt: 1, updatedAt: 1, name: 1 };
  let sortField = 'id';
  let sortOrder = '1';

  // page[size]
  if (req.query.page && (req.query.page.size !== undefined && pageSize > 1)) {
    pageSize = parseInt(req.query.page.size, 10);
  }
  // page[number]
  if (req.query.page && (req.query.page.number !== undefined && pageNumber > 0)) {
    pageNumber = parseInt(req.query.page.number, 10);
  }

  // filter[status] 1 0
  if (req.query.filter && req.query.filter.status !== undefined) {
    if (req.query.filter.status === '1') {
      filters.status = 'active';
    } else if (req.query.filter.status === '0') {
      filters.status = 'inactive';
    } else if (!res.headersSent) {
      res.status(400).send({ errors: [{ message: 'Invalid filter[status] parameter', code: 400 }] });
      return;
    }
  }

  // filter[type] (ordinary, long_running)
  if (req.query.filter && req.query.filter.type !== undefined) {
    if (req.query.filter.type in filterTypes) {
      filters.type = req.query.filter.type;
    } else {
      return res.status(400).send({ errors: [{ message: 'Invalid filter[type] parameter' }] });
    }
  }

  // filter[user]
  if (req.query.filter && req.query.filter.user !== undefined) {
    if (!req.user.isAdmin) {
      return res.status(403).send({ errors: [{ message: 'Filtering by user is only available to admins', code: 403 }] });
    }
    filters.user = req.query.filter.user;
  }

  // filter[fromTemplate]
  if (req.query.filter && req.query.filter.fromTemplate !== undefined) {
    if (mongoose.Types.ObjectId.isValid(req.query.filter.fromTemplate)) {
      filters.fromTemplate = req.query.filter.fromTemplate;
    } else {
      return res.status(400).send({ errors: [{ message: 'Invalid filter[fromTemplate] parameter', code: 400 }] });
    }
  }

  // sort createdAt, updatedAt and name,  Prefix -
  if (req.query.sort !== undefined) {
    const array = req.query.sort.split('-');
    if (array.length === 1) {
      sortField = array[0];
      sortOrder = '1';
    } else if (array.length === 2) {
      sortField = array[1];
      sortOrder = '-1';
    } else {
      error = true;
    }
    if (!(sortField in sortableFields)) error = true;

    if (error) {
      return res.status(400).send({ errors: [{ message: 'Invalid sort parameter', code: 400 }] });
    }
  }

  // search
  if (req.query.search !== undefined) {
    searchString = req.query.search.replace(/[^a-z0-9\p{L}\-_\s]/img, '');
    searchString = searchString.replace(/(^[\s]+|[\s]$)/img, '');
  }

  const response = await storage.getFlows(req.user, pageSize, pageNumber, searchString, filters, sortField, sortOrder);

  response.meta.page = pageNumber;
  response.meta.perPage = pageSize;
  response.meta.totalPages = Math.ceil(response.meta.total / pageSize);
  res.json(response);
});

// Adds a new flow to the repository
router.post('/', jsonParser, can(config.flowWritePermission), async (req, res) => {
  const { body } = req;
  // If not array, make it an array with one element
  const newFlows = Array.isArray(body) ? body : [body];

  const errors = [];
  const storeFlows = [];
  newFlows.forEach((newFlow) => {
  // Automatically adds the current user as an owner, if not already included.
    if (!newFlow.owners) {
      newFlow.owners = [];
    }
    if (newFlow.owners.findIndex((o) => (o.id === req.user.sub)) === -1) {
      newFlow.owners.push({ id: req.user.sub, type: 'user' });
    }

    const storeFlow = new Flow(newFlow);
    storeFlows.push(storeFlow);
    const error = validate(storeFlow);
    // Only add errors array if there are errors
    if (error && error.length > 0) {
      errors.push(error);
    }
  });

  if (errors && errors.length > 0) {
    log.error(`Validation errors: ${JSON.stringify(errors)}`);
    return res.status(400).send({ errors, test: 'test' });
  }

  try {
    const responses = [];
    const results = await storage.addFlows(storeFlows);
    log.debug(`Results: ${JSON.stringify(results)}`);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        log.debug(`Flow created ${JSON.stringify(result)}`);
        log.debug(`Flow ${JSON.stringify(result.value)} created`);
        const ev = {
          headers: {
            name: 'flowrepo.flow.created',
          },
          payload: {
            tenant: (req.user.tenant) ? req.user.tenant : '',
            user: req.user.sub,
            flowId: result.value.id,
          },
        };
        await publishQueue(ev);
      } else {
        log.error(`Issue creating flow ${JSON.stringify(result.reason)}`);
      }
      responses.push(result);
    }

    log.debug(`Responses: ${JSON.stringify(responses)}`);
    if (!Array.isArray(body) && responses[0] && responses[0].value) {
      // Send single flow creation result
      return res.status(201).send({ data: responses[0].value, meta: {} });
    }
    if (!Array.isArray(body) && responses[0] && responses[0].reason) {
      // Send single flow creation failure
      throw responses[0].reason;
    }
    if (responses.find((response) => response.status === 'rejected')) {
      return res.status(500).send({ errors: [{ message: responses }] });
    }
    return res.status(201).send({ data: results, meta: {} });
  } catch (err) {
    log.error(err);
    return res.status(500).send({ errors: [{ message: err }] });
  }
});

router.put('/', jsonParser, can(config.flowWritePermission), async (req, res) => {
  const { body } = req;
  // If not array, make it an array with one element
  const updatedFlows = Array.isArray(body) ? body : [body];
  const newFlows = [];

  for (const updatedFlow of updatedFlows) {
    log.debug(`PUT Requested update to flow: ${JSON.stringify(updatedFlow)}`);
    if (!mongoose.Types.ObjectId.isValid(updatedFlow.id)) {
      return res.status(400).send({ errors: `Invalid id ${updatedFlow.id}` });
    }

    const flow = await storage.getFlowById(updatedFlow.id, req.user);
    log.debug(`PUT Found flow: ${JSON.stringify(flow)}`);
    if (!flow) {
      log.info(`PUT Flow ${updatedFlow.id} not found`);
      return res.status(404).send({ errors: [{ message: `Flow with id ${updatedFlow.id} not found` }] });
    }
    if (flow.status !== 'inactive') {
      log.info(`Flow ${updatedFlow.id} is not inactive`);
      return res.status(409).send({ errors: [{ message: `Flow ${updatedFlow.id} is not inactive. Current status: ${flow.status}`, code: 409 }] });
    }

    updatedFlow._id = updatedFlow.id;
    delete updatedFlow.id;

    const updatedFlowObject = new Flow(updatedFlow);
    const error = validate(updatedFlowObject);
    log.debug(`PUT Validation errors: ${JSON.stringify(error)}`);
    if (error && error.length > 0) {
      log.error(`PUT Returning 400 response ${updatedFlow.id}`);
      return res.status(400).send({ errors: [{ message: error }] });
    }
    try {
      log.debug(`PUT updatedFlowObject is ${JSON.stringify(updatedFlowObject)}`);
      const response = await storage.updateFlow(updatedFlowObject, req.user);
      log.debug(`PUT Response: ${JSON.stringify(response)}`);
      if (response) {
        newFlows.push(response);
        const ev = {
          headers: {
            name: 'flowrepo.flow.modified',
          },
          payload: {
            tenant: (req.user.tenant) ? req.user.tenant : '',
            user: req.user.sub,
            flowId: response.id,
          },
        };

        await publishQueue(ev);
      }
    } catch (err) {
      log.error(`Exception while updating flow: ${JSON.stringify(err)}`);
      return res.status(500).send({ errors: [{ message: err }] });
    }
  }
  log.debug(`PUT Returning 200 response ${JSON.stringify(newFlows)}`);
  return res.status(200).send({ data: newFlows, meta: {} });
});

// Updates a flow with body data
router.patch('/:id', jsonParser, can(config.flowWritePermission), async (req, res) => {
  const updateData = req.body;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ errors: 'Invalid id' });
  }

  // Get the current flow
  const oldFlow = await storage.getFlowById(req.params.id, req.user);

  if (!oldFlow) {
    return res.status(404).send({ errors: [{ message: 'Flow not found', code: 404 }] });
  }

  if (oldFlow.status !== 'inactive') {
    return res.status(409).send({ errors: [{ message: `Flow is not inactive. Current status: ${oldFlow.status}`, code: 409 }] });
  }

  const updateFlow = Object.assign(oldFlow, updateData);
  updateFlow._id = updateFlow.id;
  delete updateFlow.id;

  // Re-adds the current user to the owners array if they're missing
  if (!updateFlow.owners) {
    updateFlow.owners = [];
  }
  if (updateFlow.owners.findIndex((o) => (o.id === req.user.sub)) === -1) {
    updateFlow.owners.push({ id: req.user.sub, type: 'user' });
  }

  const storeFlow = new Flow(updateFlow);

  const errors = validate(storeFlow);

  if (errors && errors.length > 0) {
    return res.status(400).send({ errors });
  }

  try {
    const response = await storage.updateFlow(storeFlow, req.user);
    const ev = {
      headers: {
        name: 'flowrepo.flow.modified',
      },
      payload: {
        tenant: (req.user.tenant) ? req.user.tenant : '',
        user: req.user.sub,
        flowId: response.id,
      },
    };

    await publishQueue(ev);

    res.status(200).send({ data: response, meta: {} });
  } catch (err) {
    res.status(500).send({ errors: [{ message: err }] });
  }
});

// Gets a flow by id
router.get('/:id', jsonParser, can(config.flowReadPermission), async (req, res) => {
  const flowId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(flowId)) {
    return res.status(400).send({ errors: [{ message: 'Invalid id', code: 400 }] });
  }

  const flow = await storage.getFlowById(flowId, req.user);

  if (!flow) {
    res.status(404).send({ errors: [{ message: 'No flow found', code: 404 }] });
  } else {
    const response = {
      data: flow,
      meta: {},
    };
    res.status(200).send(response);
  }
});

// Deletes a flow
router.delete('/:id', can(config.flowWritePermission), jsonParser, async (req, res) => {
  const flowId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(flowId)) {
    return res.status(400).send({ errors: 'Invalid id' });
  }

  const oldFlow = await storage.getFlowById(flowId, req.user);
  if (!oldFlow) {
    return res.status(404).send({ errors: [{ message: 'Flow not found', code: 404 }] });
  }

  if (oldFlow.status !== 'inactive') {
    return res.status(409).send({ errors: [{ message: `Flow is not inactive. Current status: ${oldFlow.status}`, code: 409 }] });
  }

  const response = await storage.deleteFlow(flowId, req.user);

  if (!response) {
    res.status(404).send({ errors: [{ message: 'Flow not found', code: 404 }] });
  } else {
    const ev = {
      headers: {
        name: 'flowrepo.flow.deleted',
      },
      payload: {
        tenant: (req.user.tenant) ? req.user.tenant : '',
        user: req.user.sub,
        flowId,
      },
    };

    await publishQueue(ev);
    res.status(200).send({ msg: 'Flow was successfully deleted' });
  }
});

// Get step logs
router.get('/:id/steps/:stepId/logs', async (req, res) => {
  const flow = await storage.getFlowById(req.params.id, req.user);

  if (!flow) {
    return res.status(404).send({ errors: [{ message: 'Flow not found', code: 404 }] });
  }

  const { id: flowId, stepId } = req.params;
  const url = new URL(config.loggingServiceBaseUrl);
  url.pathname = path.join(url.pathname, `/logs/flows/${flowId}/steps/${stepId}`);

  const options = {
    url: url.toString(),
    qs: req.query,
    headers: {
      authorization: `Bearer ${process.env.IAM_TOKEN}`,
    },
    json: true,
  };
  return request.get(options).pipe(res);
});

module.exports = router;
