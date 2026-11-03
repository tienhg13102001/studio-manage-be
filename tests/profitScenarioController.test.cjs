const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register');
const controller = require('../src/controllers/profitScenarioController');
const ProfitScenario = require('../src/models/ProfitScenario').default;

test('saved scenarios keep the workbook crew rates and item categories', async () => {
  assert.equal(typeof controller.parseProfitScenarioBody, 'function');
  const parsed = await controller.parseProfitScenarioBody({
    name: '  Lớp 12C4  ',
    crewCount: 3,
    leadCount: 1,
    leadRate: 1_800_000,
    crewRate: 1_600_000,
    postProductionItems: [{ label: 'Hậu kỳ', unitPrice: 200_000, quantity: 4, unit: 'class' }],
    accessoryItems: [{ label: 'Giấy màu', unitPrice: 100_000, quantity: 1, unit: 'class' }],
  });

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.name, 'Lớp 12C4');
  assert.equal(parsed.value.leadCount, 1);
  assert.equal(parsed.value.leadRate, 1_800_000);
  assert.deepEqual(parsed.value.postProductionItems, [
    { label: 'Hậu kỳ', unitPrice: 200_000, quantity: 4, unit: 'class' },
  ]);
  assert.deepEqual(parsed.value.accessoryItems, [
    { label: 'Giấy màu', unitPrice: 100_000, quantity: 1, unit: 'class' },
  ]);
});

test('old scenario payloads remain valid with the shared photographer rate', async () => {
  const parsed = await controller.parseProfitScenarioBody({
    name: 'Cũ',
    crewCount: 2,
    crewRate: 1_500_000,
  });

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.leadCount, 0);
  assert.equal(parsed.value.leadRate, 0);
  assert.deepEqual(parsed.value.postProductionItems, []);
  assert.deepEqual(parsed.value.accessoryItems, []);
});

test('negative workbook prices are rejected before saving', async () => {
  const parsed = await controller.parseProfitScenarioBody({
    name: 'Sai',
    postProductionItems: [{ label: 'Hậu kỳ', unitPrice: -1, quantity: 4, unit: 'class' }],
  });

  assert.match(parsed.error, /đơn giá và số lượng phải là số không âm/);
});

test('a scenario cannot save more lead photographers than total photographers', async () => {
  const parsed = await controller.parseProfitScenarioBody({
    name: 'Sai',
    crewCount: 2,
    leadCount: 3,
  });

  assert.match(parsed.error, /thợ lead.*tổng số thợ/i);
});

test('Mongoose scenario documents retain the new cost groups', async () => {
  const scenario = new ProfitScenario({
    name: '12C4',
    leadCount: 1,
    leadRate: 1_800_000,
    postProductionItems: [{ label: 'Hậu kỳ', unitPrice: 200_000, quantity: 4, unit: 'class' }],
    accessoryItems: [{ label: 'Sash', unitPrice: 0, quantity: 1, unit: 'student' }],
  });

  await scenario.validate();
  const savedShape = scenario.toObject();
  assert.equal(savedShape.leadCount, 1);
  assert.equal(savedShape.leadRate, 1_800_000);
  assert.equal(savedShape.postProductionItems[0].unitPrice, 200_000);
  assert.equal(savedShape.accessoryItems[0].label, 'Sash');
});
