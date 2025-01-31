class StateMachineExecutor {
    constructor({ executionStateDao, logger }) {
        this._executionStateDao = executionStateDao;
        this._logger = logger;
    }

    /**
     * Execute a state with proper tracking and idempotency
     * @param {Object} params - The parameters for state execution
     * @param {string} params.executionId - Unique identifier for this execution
     * @param {string} params.state - The state to execute
     * @param {Function} params.work - Async callback containing the work to be done
     * @param {Object} params.context - Context object passed to the work function
     * @returns {Promise<any>} - The result of the work function
     */
    async executeState({ executionId, state, work, context }) {
        const isStateCompleted = await this._executionStateDao.isStateCompleted({
            executionId,
            state
        });

        if (isStateCompleted) {
            this._logger.debug({ executionId, state }, 'State already completed, skipping');
            return;
        }

        try {
            await this._executionStateDao.updateState({ executionId, currentState: state });

            const result = await work(context);

            await this._executionStateDao.completeState({ executionId, state });

            return result;
        } catch (err) {
            await this._executionStateDao.markError({ executionId, state, error: err.message });
            throw err;
        }
    }

    /**
     * Execute a step with proper tracking and idempotency
     * @param {Object} params - The parameters for step execution
     * @param {string} params.executionId - Unique identifier for this execution
     * @param {string} params.stepId - The step ID
     * @param {Function} params.updateCounter - Async callback to update step counter
     * @param {Function} params.sendMessage - Async callback to send step message
     * @param {Object} params.context - Context object passed to the callbacks
     * @returns {Promise<void>}
     */
    async executeStep({ executionId, stepId, updateCounter, sendMessage, context }) {
        try {
            await this._executionStateDao.initializeStepExecution({ executionId, stepId });

            if (!await this._executionStateDao.isStepCounterUpdated({ executionId, stepId })) {
                await updateCounter(context);
                await this._executionStateDao.markStepCounterUpdated({ executionId, stepId });
            }

            if (!await this._executionStateDao.isStepMessageSent({ executionId, stepId })) {
                await sendMessage(context);
                await this._executionStateDao.markStepMessageSent({ executionId, stepId });
            }
        } catch (err) {
            await this._executionStateDao.markStepError({ executionId, stepId, error: err.message });
            throw err;
        }
    }

    /**
     * Initialize a new execution
     * @param {Object} params - The parameters for execution initialization
     * @param {string} params.executionId - Unique identifier for this execution
     * @param {string} params.flowExecId - Flow execution ID
     * @param {Object} params.inputMessage - Input message
     * @returns {Promise<Object>} - The execution state
     */
    async initializeExecution({ executionId, flowExecId, inputMessage }) {
        const existingExecution = await this._executionStateDao.findExecution(executionId);
        if (existingExecution) {
            if (existingExecution.isCompleted) {
                this._logger.info({ executionId }, 'Execution already completed, skipping');
                return { isCompleted: true, currentState: existingExecution.currentState };
            }
            this._logger.info({ executionId, currentState: existingExecution.currentState }, 'Resuming execution');
            return { isCompleted: false, currentState: existingExecution.currentState };
        }

        await this._executionStateDao.createExecution({
            executionId,
            flowExecId,
            currentState: 'STARTED',
            inputMessage
        });
        return { isCompleted: false, currentState: 'STARTED' };
    }

    /**
     * Mark an execution as completed
     * @param {string} executionId - The execution ID to complete
     * @returns {Promise<void>}
     */
    async completeExecution(executionId) {
        await this._executionStateDao.markCompleted({ executionId });
    }
}

module.exports = StateMachineExecutor;