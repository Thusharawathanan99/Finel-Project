const fs = require('fs');
const path = require('path');

async function runTest() {
  let samplePath = path.join(__dirname, '..', 'sample', 'test_prescription.jpg');
  if (!fs.existsSync(samplePath)) {
    console.error('No sample image found at:', samplePath);
    process.exitCode = 1;
    return;
  }
  console.log('Using sample image:', samplePath);
  if (!samplePath) {
    console.error('No sample image found');
    return;
  }

  const buf = fs.readFileSync(samplePath);
  const imageBase64 = 'data:image/jpeg;base64,' + buf.toString('base64');

  console.log('Sending request to http://localhost:3001/api/analyze-prescription...');
  const startTime = Date.now();
  const resp = await fetch('http://localhost:3001/api/analyze-prescription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      useEnsemble: true
    })
  });

  const data = await resp.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Analysis Result (took ${elapsed}s) ===`);
  console.log('Success:', data.success);
  console.log('Doctor:', data.doctorName);
  console.log('Patient:', data.patientName);
  console.log('Date:', data.date);
  console.log('Medications Count:', data.medications ? data.medications.length : 0);
  console.log('Needs Review Count:', data.medications ? data.medications.filter(m => m.needsReview).length : 0);
  console.log('\nMedications Detail:');
  console.log(JSON.stringify(data.medications, null, 2));
}

runTest().catch(console.error);
