const { expect } = require('chai');
const sinon = require('sinon');
const StateMachineExecutor = require('../src/StateMachineExecutor');

describe('StateMachineExecutor', () => {
    let executor;
    let executionStateDao;
    let logger;

    beforeEach(() => {
        executionStateDao = {
            isStateCompleted: sinon.stub(),
            updateState: sinon.stub(),
            completeState: sinon.stub(),
            markError: sinon.stub(),
            initializeStepExecution: sinon.stub(),
            isStepCounterUpdated: sinon.stub(),
            markStepCounterUpdated: sinon.stub(),
            isStepMessageSent: sinon.stub(),
            markStepMessageSent: sinon.stub(),
            markStepError: sinon.stub(),
            findExecution: sinon.stub(),
            createExecution: sinon.stub(),
            markCompleted: sinon.stub()
        };

        logger = {
            debug: sinon.stub(),
            info: sinon.stub()
        };

        executor = new StateMachineExecutor({
            executionStateDao,
            logger
        });
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('#executeState', () => {
        const executionId = 'test-exec-id';
        const state = 'TEST_STATE';
        const context = { foo: 'bar' };
        const work = sinon.stub();

        it('should skip execution if state is already completed', async () => {
            executionStateDao.isStateCompleted.resolves(true);

            await executor.executeState({ executionId, state, work, context });

            expect(work).not.to.have.been.called;
            expect(logger.debug).to.have.been.calledWith(
                { executionId, state },
                'State already completed, skipping'
            );
        });

        it('should execute work and track state for new execution', async () => {
            executionStateDao.isStateCompleted.resolves(false);
            work.resolves('work-result');

            const result = await executor.executeState({ executionId, state, work, context });

            expect(result).to.equal('work-result');
            expect(executionStateDao.updateState).to.have.been.calledWith({
                executionId,
                currentState: state
            });
            expect(work).to.have.been.calledWith(context);
            expect(executionStateDao.completeState).to.have.been.calledWith({
                executionId,
                state
            });
        });

        it('should handle errors and mark state as failed', async () => {
            const error = new Error('Test error');
            executionStateDao.isStateCompleted.resolves(false);
            work.rejects(error);

            try {
                await executor.executeState({ executionId, state, work, context });
                throw new Error('Should have thrown');
            } catch (err) {
                expect(err).to.equal(error);
                expect(executionStateDao.markError).to.have.been.calledWith({
                    executionId,
                    state,
                    error: error.message
                });
            }
        });
    });

    describe('#executeStep', () => {
        const executionId = 'test-exec-id';
        const stepId = 'test-step';
        const context = { foo: 'bar' };
        const updateCounter = sinon.stub();
        const sendMessage = sinon.stub();

        beforeEach(() => {
            // Reset stubs
            updateCounter.reset();
            sendMessage.reset();

            // Default resolutions
            executionStateDao.initializeStepExecution.resolves();
            executionStateDao.isStepCounterUpdated.resolves(false);
            executionStateDao.isStepMessageSent.resolves(false);
            executionStateDao.markStepCounterUpdated.resolves();
            executionStateDao.markStepMessageSent.resolves();
            updateCounter.resolves();
            sendMessage.resolves();
        });

        it('should execute step with counter update and message sending', async () => {
            await executor.executeStep({
                executionId,
                stepId,
                updateCounter,
                sendMessage,
                context
            });

            expect(executionStateDao.initializeStepExecution).to.have.been.calledWith({
                executionId,
                stepId
            });
            expect(updateCounter).to.have.been.calledWith(context);
            expect(executionStateDao.markStepCounterUpdated).to.have.been.calledWith({
                executionId,
                stepId
            });
            expect(sendMessage).to.have.been.calledWith(context);
            expect(executionStateDao.markStepMessageSent).to.have.been.calledWith({
                executionId,
                stepId
            });
        });

        it('should skip counter update if already updated', async () => {
            executionStateDao.isStepCounterUpdated.resolves(true);
            executionStateDao.isStepMessageSent.resolves(false);

            await executor.executeStep({
                executionId,
                stepId,
                updateCounter,
                sendMessage,
                context
            });

            expect(updateCounter).not.to.have.been.called;
            expect(executionStateDao.markStepCounterUpdated).not.to.have.been.called;
            expect(sendMessage).to.have.been.calledWith(context);
        });

        it('should skip message sending if already sent', async () => {
            executionStateDao.isStepCounterUpdated.resolves(false);
            executionStateDao.isStepMessageSent.resolves(true);

            await executor.executeStep({
                executionId,
                stepId,
                updateCounter,
                sendMessage,
                context
            });

            expect(updateCounter).to.have.been.calledWith(context);
            expect(sendMessage).not.to.have.been.called;
            expect(executionStateDao.markStepMessageSent).not.to.have.been.called;
        });

        it('should handle errors and mark step as failed', async () => {
            const error = new Error('Test error');
            executionStateDao.isStepCounterUpdated.resolves(false);
            updateCounter.rejects(error);

            try {
                await executor.executeStep({
                    executionId,
                    stepId,
                    updateCounter,
                    sendMessage,
                    context
                });
                throw new Error('Should have thrown');
            } catch (err) {
                expect(err).to.equal(error);
                expect(executionStateDao.markStepError).to.have.been.calledWith({
                    executionId,
                    stepId,
                    error: error.message
                });
            }
        });
    });

    describe('#initializeExecution', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const inputMessage = { data: 'test' };

        it('should create new execution if none exists', async () => {
            executionStateDao.findExecution.resolves(null);

            const result = await executor.initializeExecution({
                executionId,
                flowExecId,
                inputMessage
            });

            expect(result).to.deep.equal({
                isCompleted: false,
                currentState: 'STARTED'
            });
            expect(executionStateDao.createExecution).to.have.been.calledWith({
                executionId,
                flowExecId,
                currentState: 'STARTED',
                inputMessage
            });
        });

        it('should return completed state for completed execution', async () => {
            executionStateDao.findExecution.resolves({
                isCompleted: true,
                currentState: 'COMPLETED'
            });

            const result = await executor.initializeExecution({
                executionId,
                flowExecId,
                inputMessage
            });

            expect(result).to.deep.equal({
                isCompleted: true,
                currentState: 'COMPLETED'
            });
            expect(executionStateDao.createExecution).not.to.have.been.called;
            expect(logger.info).to.have.been.calledWith(
                { executionId },
                'Execution already completed, skipping'
            );
        });

        it('should resume incomplete execution', async () => {
            executionStateDao.findExecution.resolves({
                isCompleted: false,
                currentState: 'IN_PROGRESS'
            });

            const result = await executor.initializeExecution({
                executionId,
                flowExecId,
                inputMessage
            });

            expect(result).to.deep.equal({
                isCompleted: false,
                currentState: 'IN_PROGRESS'
            });
            expect(executionStateDao.createExecution).not.to.have.been.called;
            expect(logger.info).to.have.been.calledWith(
                { executionId, currentState: 'IN_PROGRESS' },
                'Resuming execution'
            );
        });
    });

    describe('#completeExecution', () => {
        it('should mark execution as completed', async () => {
            const executionId = 'test-exec-id';

            await executor.completeExecution(executionId);

            expect(executionStateDao.markCompleted).to.have.been.calledWith({
                executionId
            });
        });
    });
});