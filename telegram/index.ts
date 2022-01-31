import 'dotenv/config';
import fs from 'fs';
import bigInt from 'big-integer';
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

const connect = async () => {
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
  
  return client;
};

(async () => {
  const client = await connect();
  const queue: bigInt.BigInteger[] = [];
  let sentQty = 0;

  const fetch = async () => {
    const chatIds = (await get(ref(db, 'telegram/chatIds'))).val();

    for(const chatId of chatIds) {
      try {
        const info = await client.invoke(new Api.channels.GetFullChannel({ channel: chatId, })) as unknown as { participantsCount: number };
        const result = await client.getParticipants(chatId, { limit: info.participantsCount });
        
        console.log('Fetched', result.length, 'members of', chatId);

        const logs = (await get(ref(db, `telegram/logs`))).val() || {};

        queue.push(...(result.filter(({ id, username, bot, firstName, lastName }) => {
          if (bot || exclusions.fullName.includes(String(`${firstName} ${lastName}`).trim()) || exclusions.username.includes(username as string)) {
            return false;
          }
          return !logs[id.toString()];
        }).map(({ id, username, firstName, lastName }) => {
          console.log('Discovered', id.toString(), username, firstName, lastName);
          return id;
        })));
      } catch(e) {
        if (e instanceof Error) {
          console.error('Unable to fetch participants', chatId, e.message);
        }
      }
    }
  };

  const start = async () => {
    const SEND_TIMEOUT = parseInt(process.env.SEND_TIMEOUT as string);
    const SEND_THRESHOLD = parseFloat(process.env.SEND_THRESHOLD as string);
    
    const message = fs.readFileSync('./message.txt').toString('utf8');
    const dequeue = async () => {
      if (queue.length > 0) {
        const id = queue.pop();
        try {
          if (id && await client.sendMessage(id, { message })) {
            await set(ref(db, `telegram/logs/${id}`), true);
            sentQty++;
            console.log('Message sent to', id);
          }
        } catch(e) {
          if (e instanceof Error) {
            console.log('Unable to send a message', e.message);
          }
        }
        const timeout = SEND_TIMEOUT + (SEND_TIMEOUT * SEND_THRESHOLD * sentQty);
        console.log('Next will be sent in', timeout);
        setTimeout(dequeue, timeout);
      } else {
        console.log('Queue is empty. Skipping');
      }
    };

    await dequeue();
  };

  await fetch();
  await start();

  process.on('beforeExit', () => {
    client.session.save();
  });
})();
