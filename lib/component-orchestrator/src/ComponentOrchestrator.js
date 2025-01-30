const { Event } = require('@openintegrationhub/event-bus');
const { v1, v4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Amqp } = require('./amqp');
const _ = require('lodash');

const orchestratorId = `orchestrator-${v1()}`;

const isProcessingFlow = {};

async function loop(body, logger, loopInterval) {
    logger.info('loop TICK');
    try {
        await body();
    } catch (e) {
        logger.error(e, 'loop body error');
    }
    setTimeout(async () => {
        loop(body, logger, loopInterval);
    }, loopInterval);
}

class ComponentOrchestrator {
    constructor({
        config,
        channel,
        publishChannel,
        logger,
        queuesManager,
        queueCreator,
        flowsDao,
        flowStateDao,
        componentsDao,
        snapshotsDao,
        tokensDao,
        driver,
        eventBus,
        executionStateDao,
    }) {
        this._config = config;
        this._tokenSecret = this._config.get('ORCHESTRATOR_TOKEN_SECRET') || 'foo';
        this._logger = logger.child({ service: 'ComponentOrchestrator' });
        this._queuesManager = queuesManager;
        this._queueCreator = queueCreator;
        this._publishChannel = publishChannel;
        this._amqp = new Amqp(publishChannel, config, logger);
        this._flowsDao = flowsDao;
        this._flowStateDao = flowStateDao;
        this._componentsDao = componentsDao;
        this._snapshotsDao = snapshotsDao;
        this._driver = driver;
        this._eventBus = eventBus;
        this._tokensDao = tokensDao;
        this._channel = channel;
        this._executionStateDao = executionStateDao;
    }

    async start() {
        // create backchannel exchange, queues and bindings
        await this._queuesManager.setupBackchannel();

        await this._queuesManager.subscribeBackchannel(this._handleMessage.bind(this));

        await this._queuesManager.subscribeErrorQueue(this._handleError.bind(this));

        loop(this._processState.bind(this), this._logger, this._config.get('TICK_INTERVAL') || 10000);
    }

    async _processState() {
        const allFlows = await this._flowsDao.findAll();
        this._logger.trace({ flowsCount: allFlows.length }, 'Fetched all flows');

        const allApps = await this._driver.getAppList();
        this._logger.trace({ appsCount: allApps.length }, 'Fetched all apps');

        const appsIndex = await this._buildDeploymentIndex(allApps);
        this._logger.trace('Created app index');

        this._logger.trace('About to handle flow state');
        for (let flow of allFlows) {
            if (!isProcessingFlow[flow.id]) {
                isProcessingFlow[flow.id] = true;
                this._handleFlowState(flow, appsIndex)
                    .catch((err) => this._logger.error({ err, flow }, 'Failed to process flow'))
                    .finally(() => delete isProcessingFlow[flow.id]);
            }
        }

        this._logger.trace('About to remove lost deployments');
        this._removeLostDeployments(allApps, allFlows).catch((err) => this._logger.error({ err }));
    }

    async _handleFlowState(flow, appsIndex) {
        const logger = this._logger.child({ flowId: flow.id });
        // logger.trace(
        //     { nodes: Object.keys(appsIndex[flow.id] || {}) },
        //     'Flow nodes (local components) already running'
        // );

        if (flow.isStopping) {
            await this._deleteRunningDeploymentsForFlow(flow, appsIndex);
            await this._queuesManager.deleteForFlow(flow);
            await this._tokensDao.deleteTokenForFlowAndUser({
                flowId: flow.id,
                userId: flow.startedBy,
            });
            await this._sendFlowStoppedEvent(flow);
            await flow.onStopped();
            return;
        }

        if (flow.isPreparing) {
            if (!flow.preparingBy(orchestratorId)) return;
        }

        if (flow.isStarting) {
            await flow.onStarting(orchestratorId);
        }

        const nodes = await flow.getNodes();
        const components = {};
        let flowSettings = null;

        for (let node of nodes) {
            // if flow node is already running global component
            if (appsIndex[node.componentId]) continue;

            // if flow node is neither running local nor global
            if (!appsIndex[flow.id] || !appsIndex[flow.id][node.id]) {
                try {
                    const component = await this._componentsDao.findById(node.componentId);

                    if (!component) {
                        throw new Error('Component not found');
                    }

                    components[node.componentId] = component;

                    if (component.isGlobal) {
                        logger.warn(
                            { compId: component.id, flowId: flow.id },
                            'Warning: Global component is not running'
                        );
                        await this.startComponent(component);
                        continue;
                    }

                    logger.trace({ compId: component.id }, 'Found component');

                    if (!flowSettings) {
                        // we need to fetch all local components within the flow to call prepareQueues
                        if (Object.keys(components).length !== nodes.length) {
                            logger.trace({ flowId: flow.id }, 'Fetch missing components for flow once');
                            (
                                await Promise.all(
                                    nodes
                                        .filter((_node) => _node.id !== component.id)
                                        .map((_node) => this._componentsDao.findById(_node.componentId))
                                )
                            ).forEach((_component) => {
                                components[_component.id] = _component;
                            });
                        }
                        flowSettings = await this._queuesManager.prepareQueues(flow, components);
                    }

                    logger.trace({ nodeId: node.id, compId: component.id }, 'Going to deploy a flow node');

                    //@todo: abstraction for settings
                    const envVars = await this._queuesManager.getSettingsForNodeExecution(flow, node, flowSettings);

                    await this._driver.createApp({
                        flow,
                        node,
                        envVars,
                        component,
                        options: {
                            replicas: 1,
                            imagePullPolicy: this._config.get('KUBERNETES_IMAGE_PULL_POLICY'),
                        },
                    });
                } catch (err) {
                    logger.error(err);
                    logger.error({ compId: node.componentId, nodeId: node.id }, 'Component startup failed');
                    logger.error({ flowId: flow.id }, 'Flow startup failed');

                    await this._sendComponentFailedEvent(node.componentId);
                    this._sendFlowFailedEvent(flow);
                    return;
                }
            }
        }

        if (flow.isPreparing) {
            if (flow.startedBy) {
                try {
                    await this._tokensDao.getTokenForFlowAndUser({
                        flowId: flow.id,
                        userId: flow.startedBy,
                    });
                } catch (e) {
                    logger.error(e, 'Failed to get IAM token');
                }
            }
            await flow.onPrepared();

            await this._sendFlowStartedEvent(flow);

            await flow.onStarted();
        }
    }

    async _sendFlowStartedEvent(flow) {
        const event = new Event({
            headers: {
                name: 'flow.started',
            },
            payload: { id: flow.id },
        });

        await this._eventBus.publish(event);
    }

    async _sendFlowStoppedEvent(flow) {
        const event = new Event({
            headers: {
                name: 'flow.stopped',
            },
            payload: { id: flow.id },
        });

        await this._eventBus.publish(event);
    }

    async _sendFlowFailedEvent(flow) {
        const event = new Event({
            headers: {
                name: 'flow.failed',
            },
            payload: { id: flow.id },
        });

        await this._eventBus.publish(event);
    }

    _buildDeploymentIndex(allDeployments) {
        const result = allDeployments.reduce((index, app) => {
            if (app.flowId) {
                // deployment is part of flow
                const flowId = app.flowId;
                const nodeId = app.nodeId;
                index[flowId] = index[flowId] || {};
                index[flowId][nodeId] = app;
            } else {
                // deployment is global component
                const componentId = app.componentId;
                index[componentId] = app;
            }
            return index;
        }, {});
        return result;
    }

    async _deleteRunningDeploymentsForFlow(flow, appsIndex) {
        for (let app of Object.values(appsIndex[flow.id] || {})) {
            if (app.type !== 'global') {
                this._logger.trace({ flow: flow.id, app: app.id }, 'Going to delete flow node');
                await this._driver.destroyApp(app);
            } else {
                this._logger.trace({ flow: flow.id, app: app.id }, 'Skipped delete flow node (global component)');
            }
        }
    }

    async _removeLostDeployments(allApps, allFlows) {
        const flowsIndex = this._buildFlowsIndex(allFlows);
        for (let app of allApps) {
            const flowId = app.flowId;
            const nodeId = app.nodeId;
            if (app.type !== 'global' && (!flowsIndex[flowId] || !flowsIndex[flowId][nodeId])) {
                await this._driver.destroyApp(app);
            }
        }
    }

    _buildFlowsIndex(allFlows) {
        return allFlows.reduce((index, flow) => {
            const flowId = flow.id;
            (flow.graph.nodes || []).forEach((node) => {
                index[flowId] = index[flowId] || {};
                index[flowId][node.id] = node;
            });
            return index;
        }, {});
    }

    async _purgeSnapshots(flowExecId) {
        await this._snapshotsDao.deleteSnapshots(flowExecId);
        this._logger.info({ flowExecId }, 'Snapshots purged.');
    }

    _checkFlowProgress(flowId, stepId, flowState) {
        this._logger.info({ flowId, stepId, flowExecId: flowState.flowExecId }, 'Step done.');
        if (flowState.started === flowState.succeeded) {
            this._logger.info(
                { flowId, flowExecId: flowState.flowExecId },
                `Flow fully progressed. (${flowState.started}/${flowState.succeeded})`
            );
            this._purgeSnapshots(flowState.flowExecId);
        }
    }

    // verify & prepare command parameters

    // "run-next-steps"
    async _verifyAndPrepareRunNextSteps(flow, targetFlowStep) {
        let targetFlowId, targetStepId;

        const split = targetFlowStep.split(':');

        if (split.length > 1) {
            targetFlowId = split[0];
            targetStepId = split[1];
        } else {
            targetFlowId = flow.id;
            targetStepId = split[0];
        }

        const targetFlow = await this._flowsDao.findById(targetFlowId);

        if (!targetFlow) {
            throw new Error(`Target flow "${targetFlowId}" not started`);
        }

        if (targetFlow.startedBy !== flow.startedBy) {
            throw new Error(`Execution not permitted for user "${flow.startedBy}"`);
        }

        const props = targetFlow.getPropertiesByNodeId(targetStepId);
        if (!props) {
            throw new Error(`Target step "${targetStepId}" not found in flow "${targetFlowId}"`);
        }

        return {
            targetFlow,
            targetStepId,
            componentId: props.componentId,
        };
    }

    async _handleMessage(message) {
        let currentState = 'RECEIVED';
        try {
            const messageContent = JSON.parse(message.content.toString());
            const { routingKey } = message.fields;
            const { orchestratorToken } = message.properties.headers;
            const { stepId, flowId, flowExecId, apiKey, specialFlags } = jwt.verify(
                orchestratorToken,
                this._tokenSecret
            );

            // Create unique execution ID for this message
            const executionId = `msg-${flowExecId}-${stepId}-${v4()}`;
            
            // Check if we've already processed this state
            const existingExecution = await this._executionStateDao.findExecution(executionId);
            if (existingExecution) {
                if (existingExecution.isCompleted) {
                    this._logger.info({ executionId }, 'Message already fully processed, skipping');
                    return;
                }
                // Resume from last successful state
                this._logger.info({ executionId, currentState: existingExecution.currentState }, 'Resuming execution');
                currentState = existingExecution.currentState;
            } else {
                // Create new execution record
                await this._executionStateDao.createExecution({
                    executionId,
                    flowExecId,
                    currentState,
                    inputMessage: messageContent
                });
            }

            const flow = await this._flowsDao.findById(flowId);

            try {
                if (routingKey === 'orchestrator_backchannel.step_state') {
                    currentState = 'UPDATING_STEP_STATE';
                    const isUpdateStepStateCompleted = await this._executionStateDao.isStateCompleted({ 
                        executionId, 
                        state: currentState 
                    });
                    
                    if (!isUpdateStepStateCompleted) {
                        await this._executionStateDao.updateState({ executionId, currentState });
                        await this._flowStateDao.updateOne(
                            {
                                flowExecId,
                            },
                            {
                                $inc: {
                                    [`stepCounters.${stepId}.out`]: 1,
                                },
                            }
                        );
                        await this._executionStateDao.completeState({ executionId, state: currentState });
                    }
                    
                    currentState = 'CHECKING_PROGRESS';
                    const isCheckingProgressCompleted = await this._executionStateDao.isStateCompleted({ 
                        executionId, 
                        state: currentState 
                    });
                    
                    if (!isCheckingProgressCompleted) {
                        await this._executionStateDao.updateState({ executionId, currentState });
                        this._checkFlowProgress(flowId, stepId, await this._flowStateDao.upsertCount(flowId, flowExecId, 0, 1));
                        await this._executionStateDao.completeState({ executionId, state: currentState });
                    }
                    
                    await this._executionStateDao.markCompleted({ executionId });
                    return;
                }

                // check for privileged component
                if (specialFlags && specialFlags.privilegedComponent) {
                    currentState = 'HANDLING_PRIVILEGED';
                    const isHandlingPrivilegedCompleted = await this._executionStateDao.isStateCompleted({ 
                        executionId, 
                        state: currentState 
                    });
                    
                    if (!isHandlingPrivilegedCompleted) {
                        await this._executionStateDao.updateState({ executionId, currentState });
                        
                        const { command, parameters } = messageContent;

                        if (command) {
                            switch (command) {
                                case 'run-next-steps': {
                                    if (!parameters || !Array.isArray(parameters) || parameters.length === 0)
                                        throw new Error(
                                            `Message is missing "parameters" or "parameters" have wrong format. Expected array ["flowId:stepId"] got ${parameters}`
                                        );

                                    currentState = 'VERIFYING_NEXT_STEPS';
                                    const isVerifyingNextStepsCompleted = await this._executionStateDao.isStateCompleted({ 
                                        executionId, 
                                        state: currentState 
                                    });
                                    
                                    if (!isVerifyingNextStepsCompleted) {
                                        await this._executionStateDao.updateState({ executionId, currentState });
                                        const verifyPromises = parameters.map((targetFlowStep) =>
                                            this._verifyAndPrepareRunNextSteps(flow, targetFlowStep)
                                        );
                                        const results = await Promise.all(verifyPromises);

                                        delete messageContent.command;
                                        delete messageContent.parameters;

                                        currentState = 'UPDATING_FLOW_STATE';
                                        const isUpdatingFlowStateCompleted = await this._executionStateDao.isStateCompleted({ 
                                            executionId, 
                                            state: currentState 
                                        });
                                        
                                        if (!isUpdatingFlowStateCompleted) {
                                            await this._executionStateDao.updateState({ executionId, currentState });
                                            this._checkFlowProgress(
                                                flowId,
                                                stepId,
                                                await this._flowStateDao.upsertCount(flowId, flowExecId, results.length, 1)
                                            );
                                            await this._executionStateDao.completeState({ executionId, state: currentState });
                                        }

                                        currentState = 'EXECUTING_NEXT_STEPS';
                                        const isExecutingNextStepsCompleted = await this._executionStateDao.isStateCompleted({ 
                                            executionId, 
                                            state: currentState 
                                        });
                                        
                                        if (!isExecutingNextStepsCompleted) {
                                            await this._executionStateDao.updateState({ executionId, currentState });
                                            const promises = results.map(({ targetFlow, targetStepId, componentId }) =>
                                                this._componentsDao.findById(componentId).then((component) =>
                                                    this._executeStep({
                                                        flow: targetFlow,
                                                        flowExecId,
                                                        stepId: targetStepId,
                                                        component,
                                                        apiKey,
                                                        msg: messageContent,
                                                        executionId
                                                    })
                                                )
                                            );
                                            await Promise.all(promises);
                                            await this._executionStateDao.completeState({ executionId, state: currentState });
                                        }
                                        await this._executionStateDao.completeState({ executionId, state: 'VERIFYING_NEXT_STEPS' });
                                    }

                                    await this._executionStateDao.markCompleted({ executionId });
                                    return;
                                }
                                case 'void':
                                    currentState = 'HANDLING_VOID';
                                    const isHandlingVoidCompleted = await this._executionStateDao.isStateCompleted({ 
                                        executionId, 
                                        state: currentState 
                                    });
                                    
                                    if (!isHandlingVoidCompleted) {
                                        await this._executionStateDao.updateState({ executionId, currentState });
                                        this._checkFlowProgress(
                                            flowId,
                                            stepId,
                                            await this._flowStateDao.upsertCount(flowId, flowExecId, 0, 1)
                                        );
                                        await this._executionStateDao.completeState({ executionId, state: currentState });
                                    }
                                    await this._executionStateDao.markCompleted({ executionId });
                                    return;
                                default:
                                    delete messageContent.command;
                                    delete messageContent.parameters;
                                    break;
                            }
                        }
                        await this._executionStateDao.completeState({ executionId, state: currentState });
                    }
                }

                const nextSteps = flow.getNextSteps(stepId);

                if (nextSteps.length) {
                    currentState = 'PROCESSING_NEXT_STEPS';
                    const isProcessingNextStepsCompleted = await this._executionStateDao.isStateCompleted({ 
                        executionId, 
                        state: currentState 
                    });
                    
                    if (!isProcessingNextStepsCompleted) {
                        await this._executionStateDao.updateState({ executionId, currentState });
                        await this._flowStateDao.upsertCount(flowId, flowExecId, nextSteps.length, 0);
                        const promises = nextSteps.map((stepId) => {
                            const componentId = flow.getPropertiesByNodeId(stepId).componentId;

                            return this._componentsDao.findById(componentId).then((component) =>
                                this._executeStep({
                                    flow,
                                    flowExecId,
                                    stepId,
                                    component,
                                    apiKey,
                                    msg: JSON.parse(message.content.toString()),
                                    executionId
                                })
                            );
                        });
                        await Promise.all(promises);
                        await this._executionStateDao.completeState({ executionId, state: currentState });
                    }
                }

                await this._executionStateDao.markCompleted({ executionId });
            } catch (err) {
                await this._executionStateDao.markError({ executionId, state: currentState, error: err.message });
                throw err;
            }
        } catch (err) {
            const { taskId, stepId } = message.properties.headers;
            this._logger.error({ err, taskId, stepId, currentState }, 'Failed to process result');
        }
    }

    async _handleError(message) {
        try {
            const { orchestratorToken, reboundReason } = message.properties.headers;
            const { stepId, flowId, flowExecId, tenant } = jwt.verify(orchestratorToken, this._tokenSecret);
            let payload = {};
            try {
                payload = JSON.parse(message.content.toString());
            } catch (e) {
                this._logger.error({ stepId, flowId, flowExecId, tenant }, 'Failed to parse error message payload');
            }

            await this._flowStateDao.updateOne(
                {
                    flowExecId,
                },
                {
                    $inc: {
                        errors: 1,
                        [`stepCounters.${stepId}.errors`]: 1,
                    },
                }
            );

            this._logger.error({ stepId, flowId, flowExecId, tenant, reboundReason, payload }, 'Step error happened');
        } catch (err) {
            this._logger.error(err);
        }
    }

    async _executeStep({ flow, flowExecId, stepId, component, apiKey, msg, executionId }) {
        try {
            // Initialize step execution tracking
            await this._executionStateDao.initializeStepExecution({ executionId, stepId });

            // Only update counter if not already done
            if (!await this._executionStateDao.isStepCounterUpdated({ executionId, stepId })) {
                await this._flowStateDao.updateOne(
                    {
                        flowExecId,
                    },
                    {
                        $inc: {
                            [`stepCounters.${stepId}.in`]: 1,
                        },
                    }
                );
                await this._executionStateDao.markStepCounterUpdated({ executionId, stepId });
            }

            // Only send message if not already sent
            if (!await this._executionStateDao.isStepMessageSent({ executionId, stepId })) {
                const nodeProperties = flow.getPropertiesByNodeId(stepId);
                const functionName = nodeProperties.function;
                const secretId = nodeProperties.credentials_id;
                const fields = nodeProperties.fields || {};
                const nodeSettings = nodeProperties.nodeSettings || {};
                const { specialFlags } = component;

                const tokenPayload = {
                    flowId: flow._id.toString(),
                    stepId,
                    userId: flow.startedBy,
                    function: functionName,
                    flowExecId,
                    secretId,
                    fields,
                    apiKey,
                    nodeSettings,
                    specialFlags,
                };

                if (flow.tenant) {
                    tokenPayload.tenant = flow.tenant;
                }

                const orchestratorToken = jwt.sign(tokenPayload, this._tokenSecret);

                const record = {
                    taskId: flow._id.toString(),
                    execId: v1().replace(/-/g, ''),
                    userId: 'DOES NOT MATTER', // Required by Sailor
                    stepId,
                    orchestratorToken,
                };

        //@todo: introduce common Message class
                const newMessage = {
                    attachments: msg.attachments || {},
                    data: msg.data || {},
                    metadata: msg.metadata || {},
                    passthrough: msg.passthrough || {},
                };

        // add webhook specific keys if method exists
                if (msg.method) {
                    newMessage.method = msg.method;
                    newMessage.headers = msg.headers || {};
                    newMessage.params = msg.params || {};
                    newMessage.query = msg.query || {};
                    newMessage.url = msg.url || '';
                    newMessage.originalUrl = msg.originalUrl || '';
                    newMessage.pathSuffix = msg.pathSuffix || '';
                }

                let config;

                if (component.isGlobal) {
                    config = this._queueCreator.getAmqpGlobalStepConfig(component);
                } else {
                    config = this._queueCreator.getAmqpStepConfig(flow, stepId);
                }

                const { messagesQueue, exchangeName, deadLetterRoutingKey, inputRoutingKey } = config;

                await this._queueCreator.assertMessagesQueue(messagesQueue, exchangeName, deadLetterRoutingKey);

                await this._amqp.sendComponentInputMessage(exchangeName, inputRoutingKey, newMessage, record);
                
                await this._executionStateDao.markStepMessageSent({ executionId, stepId });
            }
        } catch (err) {
            await this._executionStateDao.markStepError({ executionId, stepId, error: err.message });
            throw err;
        }
    }

    async executeFlow({ flow, msg = {} }) {
        let currentState = 'STARTED';
        const executionId = `flow-${flow._id}-${v4()}`;
        
        try {
            // Check if we've already processed this flow execution
            const existingExecution = await this._executionStateDao.findExecution(executionId);
            if (existingExecution) {
                if (existingExecution.isCompleted) {
                    this._logger.info({ executionId }, 'Flow already executed, skipping');
                    return;
                }
                // Resume from last successful state
                this._logger.info({ executionId, currentState: existingExecution.currentState }, 'Resuming flow execution');
                currentState = existingExecution.currentState;
            } else {
                // Create new execution record
                await this._executionStateDao.createExecution({
                    executionId,
                    flowExecId: flow._id,
                    currentState,
                    inputMessage: msg
                });
            }

            // Get fresh flow data
            const _flow = await this._flowsDao.findById(flow._id);
            const { token } = await this._tokensDao.getTokenByFlowId({
                flowId: _flow._id,
            });

            const firstNode = _flow.getFirstNode();
            const stepId = firstNode.id;
            const component = await this._componentsDao.findById(firstNode.componentId);

            const externalExecId = _.get(msg, 'metadata.source.externalExecId');
            const flowExecId = externalExecId || v4();

            currentState = 'CREATING_FLOW_STATE';
            // Create flow state if not exists
            const flowState = await this._flowStateDao.findOne({ flowExecId });
            if (!flowState) {
                await this._flowStateDao.create({
                    flowId: flow._id,
                    flowExecId,
                    tenant: flow.tenant,
                    started: 1,
                });
            }

            currentState = 'EXECUTING_FIRST_STEP';
            // Execute first step
            await this._executeStep({
                flow: _flow,
                flowExecId,
                stepId,
                component,
                apiKey: token,
                msg,
                executionId
            });

            await this._executionStateDao.markCompleted({ executionId });
        } catch (err) {
            await this._executionStateDao.markStepError({ executionId, stepId: firstNode?.id, error: err.message });
            this._logger.error({ err, currentState }, 'Failed to execute flow');
            throw err;
        }
    }

    async startComponent(component) {
        component.id = component.id || component._id;
        const envVars = await this._queuesManager.getSettingsForGlobalComponent(
            component,
            await this._queuesManager.prepareQueuesForGlobalComponent(component)
        );

        await this._driver.createApp({
            envVars,
            component,
            options: {
                replicas: 1,
                imagePullPolicy: this._config.get('KUBERNETES_IMAGE_PULL_POLICY'),
            },
        });

        this._sendComponentStartedEvent(component);
    }

    async stopComponent(component) {
        component.id = component.id || component._id;
        await this._queuesManager.deleteForGlobalComponent(component);

        await this._driver.destroyApp({
            name: `global-${component.id}`,
            type: 'global',
            componentId: component.id,
        });
        this._sendComponentStoppedEvent(component);
    }

    async _sendComponentStartedEvent(component) {
        const event = new Event({
            headers: {
                name: 'component.started',
            },
            payload: { id: component.id },
        });

        await this._eventBus.publish(event);
    }

    async _sendComponentStoppedEvent(component) {
        const event = new Event({
            headers: {
                name: 'component.stopped',
            },
            payload: { id: component.id },
        });

        await this._eventBus.publish(event);
    }

    async _sendComponentFailedEvent(componentId) {
        const event = new Event({
            headers: {
                name: 'component.failed',
            },
            payload: { id: componentId },
        });

        await this._eventBus.publish(event);
    }
}

module.exports = ComponentOrchestrator;
