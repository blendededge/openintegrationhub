const FlowStateDao = require('../../src/dao/FlowStateDao');
const { expect } = require('chai');

const flowId = '123';
const flowExecId = 'foobar';
const flowExecId2 = 'foobar2';

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

describe('FlowStateDao', () => {
    beforeEach(async () => {
        await FlowStateDao.deleteMany({});
    });

    describe('With flowId and stepId', () => {
        it('should return true', async () => {
            const TOTAL_STEPS = 100;
            const steps = [...Array(TOTAL_STEPS + 1).keys()].slice(1);
            let started = [];
            let succeeded = [];
            const promises = [];

            while (steps.length > 0) {
                const newlyStarted = [];
                const newlySucceeded = [];
                if (steps.length === 1) {
                    newlyStarted.push(steps.pop());
                } else {
                    for (let i = 0; i < getRandomInt(steps.length); i++) {
                        newlyStarted.push(steps.pop());
                    }
                }

                for (let i = 0; i < getRandomInt(started.length); i++) {
                    newlySucceeded.push(started.pop());
                }

                promises.push(FlowStateDao.upsert(flowExecId, newlyStarted, newlySucceeded));

                started = started.concat(newlyStarted);
                succeeded = succeeded.concat(newlySucceeded);
            }

            await Promise.all(promises);

            // finish rest of started
            const { succeededNodes, startedNodes } = await FlowStateDao.upsert(flowExecId, [], started);

            expect(succeededNodes.length).to.equal(startedNodes.length);
            expect(succeededNodes.reduce((a, b) => a + b)).to.equal(startedNodes.reduce((a, b) => a + b));
        });
    });

    describe('Counted only', () => {
        it('should return true', async () => {
            const TOTAL_STEPS = 100;
            const steps = [...Array(TOTAL_STEPS + 1).keys()].slice(1);
            let started = [];
            let succeeded = [];
            const promises = [];

            while (steps.length > 0) {
                const newlyStarted = [];
                const newlySucceeded = [];
                if (steps.length === 1) {
                    newlyStarted.push(steps.pop());
                } else {
                    for (let i = 0; i < getRandomInt(steps.length); i++) {
                        newlyStarted.push(steps.pop());
                    }
                }

                for (let i = 0; i < getRandomInt(started.length); i++) {
                    newlySucceeded.push(started.pop());
                }

                promises.push(
                    FlowStateDao.upsertCount(flowId, flowExecId2, newlyStarted.length, newlySucceeded.length)
                );

                started = started.concat(newlyStarted);
                succeeded = succeeded.concat(newlySucceeded);
            }

            await Promise.all(promises);

            // finish rest of started
            const results = await FlowStateDao.upsertCount(flowId, flowExecId2, 0, started.length);

            expect(results.started).to.equal(results.succeeded);
        });
    });

    describe('#findByFlowExecId', () => {
        beforeEach(async () => {
            await FlowStateDao.create({
                flowId: 'my-flow',
                flowExecId: 'my-exec',
                started: 1,
                succeeded: 1
            });
        });

        it('should not find exec that does not exist', async () => {
            const flowExec = await FlowStateDao.findByFlowExecId('temp123');
            expect(flowExec).to.be.null;
        });

        it('should find existing exec', async () => {
            const flowExec = await FlowStateDao.findByFlowExecId('my-exec');
            expect(flowExec).not.to.be.null;
            expect(flowExec.flowId).to.equal('my-flow');
            expect(flowExec.started).to.equal(1);
            expect(flowExec.succeeded).to.equal(1);
        });
    });

    describe('#find', () => {
        beforeEach(async () => {
            await FlowStateDao.create({
                flowId: 'flow1',
                flowExecId: 'my-exec1',
                started: 1,
                succeeded: 1
            });
            await FlowStateDao.create({
                flowId: 'flow1',
                flowExecId: 'my-exec2',
                started: 1,
                succeeded: 1
            });
        });

        afterEach(async () => {
            await FlowStateDao.delete('my-exec1');
            await FlowStateDao.delete('my-exec2');
        });

        it('should find execs by flowId', async () => {
            const execs = await FlowStateDao.find({ flowId: 'flow1' });
            expect(execs.length).to.equal(2);
            expect(execs.map(e => e.flowExecId).sort()).to.deep.equal(['my-exec1', 'my-exec2']);
        });
    });

    describe('#upsertCount', () => {
        const flowId = 'test-flow';
        const flowExecId = 'test-exec';

        it('should create new flow state with counters', async () => {
            const result = await FlowStateDao.upsertCount(flowId, flowExecId, 5, 3);

            expect(result).to.deep.include({
                flowId,
                flowExecId,
                started: 5,
                succeeded: 3
            });
        });

        it('should increment existing flow state counters', async () => {
            await FlowStateDao.create({
                flowId,
                flowExecId,
                started: 2,
                succeeded: 1
            });

            const result = await FlowStateDao.upsertCount(flowId, flowExecId, 3, 2);

            expect(result).to.deep.include({
                flowId,
                flowExecId,
                started: 5,
                succeeded: 3
            });
        });

        it('should handle concurrent updates with retry on duplicate key error', async () => {
            // Simulate concurrent updates by creating two states
            const promises = [
                FlowStateDao.upsertCount(flowId, flowExecId, 2, 1),
                FlowStateDao.upsertCount(flowId, flowExecId, 3, 2)
            ];

            await Promise.all(promises);
            const finalState = await FlowStateDao.findByFlowExecId(flowExecId);

            expect(finalState.started).to.equal(5);
            expect(finalState.succeeded).to.equal(3);
        });
    });

    describe('#upsert', () => {
        const flowExecId = 'test-exec';

        it('should track started and succeeded nodes', async () => {
            const startedNodes = [1, 2, 3];
            const succeededNodes = [1, 2];

            const result = await FlowStateDao.upsert(flowExecId, startedNodes, succeededNodes);

            expect(result.startedNodes).to.have.members(startedNodes);
            expect(result.succeededNodes).to.have.members(succeededNodes);
        });

        it('should append new nodes to existing arrays', async () => {
            await FlowStateDao.create({
                flowExecId,
                startedNodes: [1, 2],
                succeededNodes: [1]
            });

            const result = await FlowStateDao.upsert(flowExecId, [3, 4], [2, 3]);

            expect(result.startedNodes).to.have.members([1, 2, 3, 4]);
            expect(result.succeededNodes).to.have.members([1, 2, 3]);
        });

        it('should handle concurrent updates with retry on duplicate key error', async () => {
            const promises = [
                FlowStateDao.upsert(flowExecId, [1, 2], [1]),
                FlowStateDao.upsert(flowExecId, [3, 4], [2, 3])
            ];

            await Promise.all(promises);
            const finalState = await FlowStateDao.findByFlowExecId(flowExecId);

            expect(finalState.startedNodes).to.have.members([1, 2, 3, 4]);
            expect(finalState.succeededNodes).to.have.members([1, 2, 3]);
        });

        it('should maintain order of nodes in arrays', async () => {
            const startedNodes = [1, 2, 3, 4, 5];
            const succeededNodes = [1, 2, 3];

            const result = await FlowStateDao.upsert(flowExecId, startedNodes, succeededNodes);

            expect(result.startedNodes).to.deep.equal(startedNodes);
            expect(result.succeededNodes).to.deep.equal(succeededNodes);
        });
    });

    describe('#findByFlowExecId', () => {
        const flowExecId = 'test-exec';

        it('should return null for non-existent flow execution', async () => {
            const result = await FlowStateDao.findByFlowExecId(flowExecId);
            expect(result).to.be.null;
        });

        it('should return flow state for existing execution', async () => {
            const state = {
                flowExecId,
                flowId: 'test-flow',
                started: 5,
                succeeded: 3,
                startedNodes: [1, 2, 3],
                succeededNodes: [1, 2]
            };

            await FlowStateDao.create(state);

            const result = await FlowStateDao.findByFlowExecId(flowExecId);
            expect(result).to.deep.include(state);
        });
    });

    describe('#delete', () => {
        const flowExecId = 'test-exec';

        it('should delete flow state', async () => {
            await FlowStateDao.create({
                flowExecId,
                flowId: 'test-flow'
            });

            await FlowStateDao.delete(flowExecId);

            const result = await FlowStateDao.findByFlowExecId(flowExecId);
            expect(result).to.be.null;
        });

        it('should not throw error when deleting non-existent flow state', async () => {
            const result = await FlowStateDao.delete(flowExecId);
            expect(result.deletedCount).to.equal(0);
        });
    });
});
