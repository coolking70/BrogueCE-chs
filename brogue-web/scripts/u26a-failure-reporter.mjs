import fs from 'node:fs';
export default class U26aFailureReporter {
    onTestCaseResult(testCase) {
        const result = testCase.result();
        if (result.state !== 'failed') return;
        fs.appendFileSync('ai_docs/reports/u-26a-evidence/failures-final.ndjson', JSON.stringify({
            file: testCase.module.moduleId, test: testCase.fullName,
            errors: result.errors.map(e => ({ name: e.name, message: e.message, stack: e.stack }))
        }) + '\n');
    }
}
