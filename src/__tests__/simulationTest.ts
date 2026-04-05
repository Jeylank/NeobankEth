import {
  createInitialState,
  runSignup,
  runKYC,
  runWalletTopup,
  runFXCalculation,
  runRemittance,
  runPartnerPayout,
  runCompletion,
  SimulationState,
} from '../services/simulationService';

function logStep(label: string, state: SimulationState) {
  const step = state.steps[state.currentStep];
  const icon =
    step.status === 'completed' ? '✅' :
    step.status === 'running' ? '⏳' :
    step.status === 'failed' ? '❌' : '⬜';
  console.log(`\n${icon} STEP ${state.currentStep + 1}/7: ${label}`);
  console.log(`   Status: ${step.status}`);
  if (step.data) {
    Object.entries(step.data).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        console.log(`   ${key}: ${JSON.stringify(value)}`);
      } else {
        console.log(`   ${key}: ${value}`);
      }
    });
  }
  if (step.timestamp) {
    console.log(`   Completed at: ${step.timestamp}`);
  }
}

async function runFullTest() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  SUMSUMA END-TO-END FLOW SIMULATION');
  console.log('  Non-Custodial Partner Model');
  console.log('═══════════════════════════════════════════════════');

  let state = createInitialState();
  let lastState = state;
  const onUpdate = (s: SimulationState) => { lastState = s; };

  console.log('\n▶ Starting full flow simulation...\n');

  // Step 1: User Signup
  state = await runSignup(onUpdate, state);
  logStep('USER SIGNUP', state);

  // Step 2: KYC Verification
  state = await runKYC(onUpdate, state);
  logStep('KYC VERIFICATION', state);

  // Step 3: Wallet Top-up
  state = await runWalletTopup(onUpdate, state);
  logStep('WALLET TOP-UP', state);

  // Step 4: FX Calculation
  state = await runFXCalculation(onUpdate, state);
  logStep('FX CALCULATION', state);

  // Step 5: Remittance Transfer
  state = await runRemittance(onUpdate, state);
  logStep('REMITTANCE TRANSFER', state);

  // Step 6: Partner Payout
  state = await runPartnerPayout(onUpdate, state);
  logStep('PARTNER PAYOUT (Chapa)', state);

  // Step 7: Transaction Completion
  state = await runCompletion(onUpdate, state);
  logStep('TRANSACTION COMPLETE', state);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SIMULATION SUMMARY');
  console.log('═══════════════════════════════════════════════════');

  const allPassed = state.steps.every((s) => s.status === 'completed');
  console.log(`  Steps completed: ${state.steps.filter((s) => s.status === 'completed').length}/7`);
  console.log(`  Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  console.log(`  Flow complete: ${state.isComplete}`);

  const completionData = state.steps[6].data;
  if (completionData) {
    console.log(`  Amount sent: ${completionData.amountSent}`);
    console.log(`  Amount delivered: ${completionData.amountDelivered}`);
    console.log(`  Beneficiary: ${completionData.beneficiary}`);
    console.log(`  Provider: ${completionData.provider}`);
    console.log(`  Provider Ref: ${completionData.providerRef}`);
    console.log(`  Duration: ${completionData.totalDuration}`);
  }

  console.log('═══════════════════════════════════════════════════\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runFullTest().catch((err) => {
  console.error('❌ SIMULATION FAILED:', err);
  process.exit(1);
});
