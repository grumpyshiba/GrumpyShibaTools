import 'dotenv/config';
import fs from 'fs';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { initializeApp } from 'firebase/app';
import { get, getDatabase, ref, set } from 'firebase/database';
import exclusions from './exclusions.json';

const readline = require('readline/promises');

const stringSession = new StringSession(process.env.SESSION_ID);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log({
  apiKey: process.env.DB_API_KEY as string,
  authDomain: process.env.DB_AUTH_DOMAIN as string,
  projectId: process.env.DB_PROJECT_ID as string,
  storageBucket: process.env.DB_STORAGE_BUCKET as string,
  messagingSenderId: process.env.DB_MESSAGING_SENDER_ID as string,
  appId: process.env.DB_APP_ID as string,
  measurementId: process.env.DB_MEASUREMENT_ID as string
});

const app = initializeApp({
  apiKey: process.env.DB_API_KEY as string,
  authDomain: process.env.DB_AUTH_DOMAIN as string,
  projectId: process.env.DB_PROJECT_ID as string,
  storageBucket: process.env.DB_STORAGE_BUCKET as string,
  messagingSenderId: process.env.DB_MESSAGING_SENDER_ID as string,
  appId: process.env.DB_APP_ID as string,
  measurementId: process.env.DB_MEASUREMENT_ID as string
});

const db = getDatabase(app);

(async () => {
  const client = new TelegramClient(stringSession, parseInt(process.env.API_ID as string), process.env.API_HASH as string, {
    connectionRetries: 10,
  });
  await client.start({
    phoneNumber: async () => await rl.question('Please enter your number: '),
    password: async () => await rl.question('Please enter your password: '),
    phoneCode: async () =>
      await rl.question('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  const queue: any[] = [];
  const chatIds = (await get(ref(db, 'telegram/chatIds'))).val();

  for(const chatId of chatIds) {
    const info = await client.invoke(new Api.channels.GetFullChannel({ channel: chatId, }));
    const result = await client.getParticipants(chatId, { limit: (info.fullChat as any).participantsCount });
    const logs = (await get(ref(db, `telegram/logs`))).val() || {};

    queue.push(...(result.filter(({ id, username, firstName, lastName }) => {
      if (exclusions.fullName.includes(`${firstName} ${lastName}`) || exclusions.username.includes(username as string)) {
        return false;
      }
      return !logs[id.toString()];
    }).map(({ id, username, firstName, lastName }) => {
      console.log('Discovered', id.toString(), username, firstName, lastName);
      return id;
    })));
  }

  const message = fs.readFileSync('./message.txt').toString('utf8');

  setInterval(async () => {
    if (queue.length > 0) {
      const id = queue.pop();
      if (await client.sendMessage(id, { message })) {
        set(ref(db, `telegram/logs/${id}`), true);
      }
    } else {
      console.log('Queue is empty. Skipping');
    }
  }, parseInt(process.env.SEND_TIMEOUT as string));

  console.log('You should now be connected.');
  console.log(client.session.save());
})();
