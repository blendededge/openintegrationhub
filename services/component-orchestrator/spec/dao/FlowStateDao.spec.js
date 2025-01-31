const FlowStateDao = require('../../src/dao/FlowStateDao');
const { expect } = require('chai');

const flowId = '123';
const flowExecId = 'foobar';
const flowExecId2 = 'foobar2';

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

describe('FlowStateDao', () => {
    before(async () => {
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
        before(async () => {
            await FlowStateDao.upsertCount('flow1', 'my-exec1', 1, 1);
            await FlowStateDao.upsertCount('flow1', 'my-exec2', 1, 1);
        });

        after(async () => {
            await FlowStateDao.delete('my-exec1');
            await FlowStateDao.delete('my-exec2');
        });

        it('should find execs by flowId', async () => {
            const execs = await FlowStateDao.find({ flowId: 'flow1' });
            expect(execs.length).to.equal(2);
            expect(execs[0].flowExecId).to.equal('my-exec1');
            expect(execs[1].flowExecId).to.equal('my-exec2');
        });
    });
});
