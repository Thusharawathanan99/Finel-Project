const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const stateFile = path.join(require('os').homedir(), '.expo', 'state.json');

if (!fs.existsSync(stateFile)) {
  console.error('\n❌ No Expo login found. Please run:\n   npx eas login\n');
  process.exit(1);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (e) {
  console.error('❌ Could not parse Expo state file:', e.message);
  process.exit(1);
}

const sessionSecret = state?.auth?.sessionSecret;
if (!sessionSecret) {
  console.error('\n❌ You are currently logged out. Please log in with your new email by running:\n   npx eas login\n');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'expo-session': sessionSecret },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function linkApp(slug, appDirRel) {
  const appDir = path.join(rootDir, appDirRel);
  console.log(`\n========================================`);
  console.log(`Linking ${slug} (${appDirRel})...`);
  console.log(`========================================`);

  // Get current user and account ID
  const meRes = await gql(`query { meActor { __typename ... on User { id username accounts { id name } } } }`);
  const user = meRes.data?.meActor;
  if (!user) {
    console.error('❌ Could not fetch user details from Expo. Please re-login using: npx eas login');
    process.exit(1);
  }

  const accounts = user.accounts;
  if (!accounts || accounts.length === 0) {
    console.error('❌ No accounts found for user:', user.username);
    process.exit(1);
  }

  const accountId = accounts[0].id;
  const accountName = accounts[0].name;
  console.log(`Logged in as: ${user.username} (Account: ${accountName})`);

  // Check if project already exists under new account
  const findRes = await gql(`query { app { byFullName(fullName: "@${accountName}/${slug}") { id slug } } }`);
  let projectId = findRes.data?.app?.byFullName?.id;

  if (projectId) {
    console.log(`Found existing project on new account: ${projectId}`);
  } else {
    console.log(`Creating project "${slug}" on account "${accountName}"...`);
    const createRes = await gql(
      `mutation CreateApp($appInput: AppInput!) { app { createApp(appInput: $appInput) { id slug } } }`,
      { appInput: { accountId, projectName: slug } }
    );
    if (createRes.errors) {
      console.error('❌ Create project error:', JSON.stringify(createRes.errors, null, 2));
      process.exit(1);
    }
    projectId = createRes.data?.app?.createApp?.id;
    console.log(`✅ Created project successfully: ${projectId}`);
  }

  // Update app.json
  const appJsonPath = path.join(appDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  if (!appJson.expo.extra) appJson.expo.extra = {};
  if (!appJson.expo.extra.eas) appJson.expo.extra.eas = {};
  appJson.expo.extra.eas.projectId = projectId;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
  console.log(`✅ Updated ${appDirRel}/app.json with new projectId: ${projectId}`);
  return projectId;
}

async function main() {
  console.log('--- Expo Account Re-link Tool ---');
  await linkApp('careconnect-patient', '5-patient');
  await linkApp('careconnect-caretaker', '6-caretaker');
  console.log('\n🎉 Both apps are successfully linked to your new Expo account!');
  console.log('\nYou can now generate your APKs with:');
  console.log('   npm run build:apk:patient');
  console.log('   npm run build:apk:caretaker');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
