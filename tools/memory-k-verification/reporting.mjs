// Reporting never alters test outcomes or the runner's failure exit status.
export function classifyResults(results) {
  const original=result=>/\/memory-k-original-S(?:0[1-9]|10)\.test\.mjs$/.test(result.file);
  const gates=results.filter(original),verification=results.filter(result=>!original(result));
  return {
    scopedVerification:{status:verification.length?verification.every(row=>row.passed)?'passed':'failed':'not_run',
      files:verification.length,failures:verification.filter(row=>!row.passed).map(row=>row.file)},
    originalReleaseGates:{status:gates.length?gates.every(row=>row.passed)?'passed_source_only':'failed':'not_run',
      files:gates.length,failures:gates.filter(row=>!row.passed).map(row=>row.file)},
    releaseAcceptance:'not_certified',
  };
}

export function summaryMarkdown(receipt) {
  const health=receipt.health;
  return [
    `### Memory K ${receipt.profile} — ${receipt.head}`,
    `Exact clean head: **${receipt.exactCleanHead}**. Test result: **${receipt.passed?'passed':'failed'}**.`,
    `Scoped verification: **${health.scopedVerification.status}** (${health.scopedVerification.files} files).`,
    `Original S01–S10 source gates: **${health.originalReleaseGates.status}** (${health.originalReleaseGates.files} files).`,
    'Original gate failures remain failed assertions. Other failures are unresolved verification/source failures and must be investigated; they are not expected passes.',
    ...health.scopedVerification.failures.map(file=>`- Unresolved verification/source failure: ${file}`),
    ...health.originalReleaseGates.failures.map(file=>`- Original release gate failure: ${file}`),
    'Release acceptance remains un-certified. Native, independently verified packaging, physical GTA and soak evidence are separate gates.',
    '',
  ].join('\n\n');
}
