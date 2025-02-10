const { expect } = require('chai');
const ExecutionStateDao = require('../../src/dao/ExecutionStateDao');

describe('ExecutionStateDao', () => {
    beforeEach(async () => {
        await ExecutionStateDao.deleteMany({});
    });

    describe('#isStateCompleted', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const state = 'TEST_STATE';

        it('should return false for non-existent state', async () => {
            const result = await ExecutionStateDao.isStateCompleted({ executionId, state });
            expect(result).to.be.false;
        });

        it('should return true for completed state', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: state,
                stateHistory: [{
                    state,
                    startedAt: new Date(),
                    completedAt: new Date()
                }]
            });

            const result = await ExecutionStateDao.isStateCompleted({ executionId, state });
            expect(result).to.be.true;
        });

        it('should return false for incomplete state', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: state,
                stateHistory: [{
                    state,
                    startedAt: new Date()
                }]
            });

            const result = await ExecutionStateDao.isStateCompleted({ executionId, state });
            expect(result).to.be.false;
        });
    });

    describe('#updateState', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const currentState = 'NEW_STATE';

        it('should update current state', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }]
            });

            await ExecutionStateDao.updateState({ executionId, currentState });

            const state = await ExecutionStateDao.findOne({ executionId });
            expect(state).to.not.be.null;
            expect(state.currentState).to.equal(currentState);
            expect(state.stateHistory).to.have.lengthOf(2);
            expect(state.stateHistory[1].state).to.equal(currentState);
        });
    });

    describe('#completeState', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const state = 'TEST_STATE';

        it('should mark state as completed', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: state,
                stateHistory: [{
                    state,
                    startedAt: new Date()
                }]
            });

            await ExecutionStateDao.completeState({ executionId, state });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.stateHistory[0].completedAt).to.exist;
        });
    });

    describe('#initializeStepExecution', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';

        it('should initialize step execution state', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }]
            });

            await ExecutionStateDao.initializeStepExecution({ executionId, stepId });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.stepExecutions).to.have.lengthOf(1);
            expect(execution.stepExecutions[0]).to.deep.include({
                stepId,
                counterUpdated: false,
                messageSent: false
            });
        });
    });

    describe('#isStepCounterUpdated', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';

        it('should return false for non-existent step', async () => {
            const result = await ExecutionStateDao.isStepCounterUpdated({ executionId, stepId });
            expect(result).to.be.false;
        });

        it('should return true when counter is updated', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                stepExecutions: [{
                    stepId,
                    counterUpdated: true,
                    messageSent: false
                }]
            });

            const result = await ExecutionStateDao.isStepCounterUpdated({ executionId, stepId });
            expect(result).to.be.true;
        });
    });

    describe('#markStepCounterUpdated', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';

        it('should mark step counter as updated', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                stepExecutions: [{
                    stepId,
                    counterUpdated: false,
                    messageSent: false
                }]
            });

            await ExecutionStateDao.markStepCounterUpdated({ executionId, stepId });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.stepExecutions[0].counterUpdated).to.be.true;
        });
    });

    describe('#isStepMessageSent', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';

        it('should return false for non-existent step', async () => {
            const result = await ExecutionStateDao.isStepMessageSent({ executionId, stepId });
            expect(result).to.be.false;
        });

        it('should return true when message is sent', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                stepExecutions: [{
                    stepId,
                    counterUpdated: false,
                    messageSent: true
                }]
            });

            const result = await ExecutionStateDao.isStepMessageSent({ executionId, stepId });
            expect(result).to.be.true;
        });
    });

    describe('#markStepMessageSent', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';

        it('should mark step message as sent', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                stepExecutions: [{
                    stepId,
                    counterUpdated: true,
                    messageSent: false
                }]
            });

            await ExecutionStateDao.markStepMessageSent({ executionId, stepId });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.stepExecutions[0].messageSent).to.be.true;
            expect(execution.stepExecutions[0].completedAt).to.exist;
        });
    });

    describe('#markStepError', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const stepId = 'test-step';
        const error = 'Test step error';

        it('should mark step as errored', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                stepExecutions: [{
                    stepId,
                    counterUpdated: false,
                    messageSent: false
                }]
            });

            await ExecutionStateDao.markStepError({ executionId, stepId, error });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.stepExecutions[0].error).to.equal(error);
            expect(execution.stepExecutions[0].completedAt).to.exist;
        });
    });

    describe('#findExecution', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';

        it('should return null for non-existent execution', async () => {
            const result = await ExecutionStateDao.findExecution(executionId);
            expect(result).to.be.null;
        });

        it('should return execution state', async () => {
            const state = {
                executionId,
                flowExecId,
                currentState: 'TEST_STATE',
                stateHistory: [{
                    state: 'TEST_STATE',
                    startedAt: new Date()
                }],
                isCompleted: true
            };

            await ExecutionStateDao.create(state);

            const result = await ExecutionStateDao.findExecution(executionId);
            expect(result).to.deep.include({
                executionId: state.executionId,
                flowExecId: state.flowExecId,
                currentState: state.currentState,
                isCompleted: state.isCompleted
            });
        });
    });

    describe('#createExecution', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';
        const currentState = 'INITIAL';
        const inputMessage = { data: 'test' };

        it('should create new execution state', async () => {
            await ExecutionStateDao.createExecution({
                executionId,
                flowExecId,
                currentState,
                inputMessage
            });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution).to.deep.include({
                executionId,
                flowExecId,
                currentState,
                inputMessage,
                isCompleted: false
            });
            expect(execution.stateHistory).to.have.lengthOf(1);
            expect(execution.stateHistory[0].state).to.equal(currentState);
            expect(execution.stateHistory[0].startedAt).to.exist;
        });
    });

    describe('#markCompleted', () => {
        const executionId = 'test-exec-id';
        const flowExecId = 'test-flow-exec';

        it('should mark execution as completed', async () => {
            await ExecutionStateDao.create({
                executionId,
                flowExecId,
                currentState: 'INITIAL',
                stateHistory: [{
                    state: 'INITIAL',
                    startedAt: new Date()
                }],
                isCompleted: false
            });

            await ExecutionStateDao.markCompleted({ executionId });

            const execution = await ExecutionStateDao.findOne({ executionId });
            expect(execution.isCompleted).to.be.true;
            expect(execution.completedAt).to.exist;
        });
    });
});