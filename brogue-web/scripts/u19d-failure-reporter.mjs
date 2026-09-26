import fs from 'node:fs';
// Retain a completed failure immediately even if a long full run is interrupted.
export default class U19cFailureReporter {
    onTestCaseResult(testCase) {
        const result = testCase.result();
        if (result.state !== 'failed') return;
        fs.appendFileSync('ai_docs/reports/u-19d-evidence/failures-final.ndjson', JSON.stringify({
            file: testCase.module.moduleId,
            test: testCase.fullName,
            errors: result.errors.map(error => ({name: error.name, message: error.message, stack: error.stack})),
        }) + '\n');
    }
}
