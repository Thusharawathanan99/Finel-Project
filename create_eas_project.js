const fs = require('fs');
const path = require('path');

const stateFile = path.join(require('os').homedir(), '.expo', 'state.json');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const sessionSecret = state.auth.sessionSecret;

async function gql(query, variables = {}) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'expo-session': sessionSecret },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function main() {
  const slug = process.argv[2];
  const appDir = process.argv[3];
  if (!slug || !appDir) { console.log('Usage: node create_eas_project.js <slug> <app-dir>'); process.exit(1); }

  // Get current user and account ID
  const meRes = await gql(`query { meActor { __typename ... on User { id username accounts { id name } } } }`);
  console.log('User info:', JSON.stringify(meRes.data?.meActor, null, 2));

  const accounts = meRes.data?.meActor?.accounts;
  if (!accounts || accounts.length === 0) { console.error('No accounts found'); process.exit(1); }

  const accountId = accounts[0].id;
  console.log(`Using account: ${accounts[0].name} (${accountId})`);

  // Try to find existing project
  const findRes = await gql(`query { app { byFullName(fullName: "@${accounts[0].name}/${slug}") { id slug } } }`);
  let projectId = findRes.data?.app?.byFullName?.id;

  if (projectId) {
    console.log(`Existing project found: ${projectId}`);
  } else {
    // Create new project
    const createRes = await gql(
      `mutation CreateApp($appInput: AppInput!) { app { createApp(appInput: $appInput) { id slug } } }`,
      { appInput: { accountId, projectName: slug } }
    );
    if (createRes.errors) {
      console.error('Create errors:', JSON.stringify(createRes.errors));
      process.exit(1);
    }
    projectId = createRes.data?.app?.createApp?.id;
    console.log(`Created project: ${projectId}`);
  }

  // Update app.json
  const appJsonPath = path.join(appDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  if (!appJson.expo.extra) appJson.expo.extra = {};
  if (!appJson.expo.extra.eas) appJson.expo.extra.eas = {};
  appJson.expo.extra.eas.projectId = projectId;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
  console.log(`Updated ${appJsonPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
