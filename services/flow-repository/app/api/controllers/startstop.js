/* eslint no-underscore-dangle: "off" */
/* eslint max-len: "off" */
/* eslint func-names: "off" */
/* eslint consistent-return: "off" */

// const path = require('path');
// const _ = require('lodash');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const { can } = require('@openintegrationhub/iam-utils');
const config = require('../../config/index');
const { publishQueue } = require('../../utils/eventBus');

const storage = require(`./${config.storage}`); // eslint-disable-line

const jsonParser = bodyParser.json();
const router = express.Router();

const log = require('../../config/logger'); // eslint-disable-line

async function bulkAction(action, req, res) {
  const { body } = req;
  const filters = [];
  const pageNumber = 1;
  const pageSize = 1000;
  const sortField = 'id';
  const sortOrder = '1';

  // filter[fromTemplate]
  if (req.query.filter && req.query.filter.fromTemplate !== undefined) {
    if (mongoose.Types.ObjectId.isValid(req.query.filter.fromTemplate)) {
      filters.fromTemplate = req.query.filter.fromTemplate;
    } else {
      return res.status(400).send({ errors: [{ message: 'Invalid filter[fromTemplate] parameter', code: 400 }] });
    }
  }

  let flows = [];
  if (filters.fromTemplate) {
    flows = (await storage.getFlows(req.user, pageSize, pageNumber, '', filters, sortField, sortOrder)).data;
  } else {
    // If not array, make it an array with one element
    flows = Array.isArray(body) ? body : [body];
  }

  return Promise.allSettled(flows.map((flow) => action(flow.id, req.user))).then((results) => {
    log.debug(`bulkAction results = ${JSON.stringify(results)}`);
    if (results.find((response) => response.status === 'rejected')) {
      return res.status(500).send({ errors: [{ message: results }] });
    }
    const errors = results.find((response) => response.status === 'fulfilled' && response.value.errors);
    if (errors) {
      if (errors.value.errors > 0 && errors.value.errors.errors[0].code) {
        return res.status(errors.value.errors[0].code).send({ data: results, meta: {} });
      }
    }
    if (results.errors && results.errors.length > 0 && results.errors[0].code) {
      return res.status(results.errors[0].code).send({ errors: results.errors });
    }
    return res.status(200).send({ data: results, meta: {} });
  });
}
async function startFlow(flowId, user) {
  if (!mongoose.Types.ObjectId.isValid(flowId)) {
    return { errors: [{ message: `Invalid id ${flowId}`, code: 400 }] };
  }

  const currentFlow = await storage.getFlowById(flowId, user);
  if (!currentFlow) {
    return { errors: [{ message: 'No flow with this ID found', code: 404 }] };
  }

  // if (currentFlow.status !== 'inactive') {
  //   return res.status(409).send({ errors: [{ message: `Flow is not inactive. Current status: ${currentFlow.status}`, code: 409 }] });
  // }

  const flow = await storage.startingFlow(user, flowId);

  const ev = {
    headers: {
      name: 'flow.starting',
    },
    payload: flow,
  };

  ev.payload.startedBy = user.sub;

  await publishQueue(ev);
  return { flow };
}
// Start a flow
router.post('/:id/start', jsonParser, can(config.flowControlPermission), async (req, res) => {
  const flowId = req.params.id;

  const results = await startFlow(flowId, req.user);
  if (results.errors && results.errors.length > 0 && results.errors[0].code) {
    return res.status(results.errors[0].code).send({ errors: results.errors });
  }

  return res.status(200).send({ data: { id: results.flow.id, status: results.flow.status }, meta: {} });
});

router.post('/start', jsonParser, can(config.flowControlPermission), async (req, res) => await bulkAction(startFlow, req, res));

async function stopFlow(flowId, user) {
  if (!mongoose.Types.ObjectId.isValid(flowId)) {
    return { errors: [{ message: `Invalid id ${flowId}`, code: 400 }] };
  }

  const currentFlow = await storage.getFlowById(flowId, user);
  if (!currentFlow) {
    return { errors: [{ message: `No flow with this ID found ${flowId}`, code: 404 }] };
  }

  // if (currentFlow.status !== 'active') {
  //   return res.status(409).send({ errors: [{ message: `Flow is not active. Current status: ${currentFlow.status}`, code: 409 }] });
  // }

  const flow = await storage.stoppingFlow(user, flowId);

  const ev = {
    headers: {
      name: 'flow.stopping',
    },
    payload: flow,
  };

  await publishQueue(ev);
  return { flow };
}
// Stop a flow
router.post('/:id/stop', jsonParser, can(config.flowControlPermission), async (req, res) => {
  const flowId = req.params.id;
  const result = await stopFlow(flowId, req.user);
  if (result.errors && result.errors > 0 && result.errors[0].code) {
    return res.status(result.errors[0].code).send({ errors: result.errors });
  }

  return res.status(200).send({ data: { id: result.flow.id, status: result.flow.status }, meta: {} });
});

router.post('/stop', jsonParser, can(config.flowControlPermission), async (req, res) => await bulkAction(stopFlow, req, res));

module.exports = router;
