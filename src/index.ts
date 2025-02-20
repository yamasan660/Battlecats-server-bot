import { MessageEmbed, Message, TextChannel, Role, CategoryChannel } from 'discord.js';
import Bot from './Components/Bot';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import http from 'http';
import events from './events.json';
import fs from 'fs';
import config from './config.json';
import path from 'path';

// .envから値の読み込み
dotenv.config();

// Webサーバーの作成
http
  .createServer((req, res) => {
    res.end('It works!');
  })
  .listen(process.env.PORT || 8080);

const client = Bot.client;

// MySQLサーバーへ接続
Bot.db.connect();

cron.schedule('0,15 * * * *', async () => {
  for (const event of events) {
    const timeLag = Date.now() - Date.parse(event.date);

    if (timeLag >= -60000 && timeLag <= 600000) {
      const mentionRole = client.guilds.cache
        .get('755774191613247568')
        ?.roles.cache.filter((role: Role) => role.name.includes(event.role))
        .first()?.id;

      (client.channels.cache.get('805732155606171658') as TextChannel)?.send(
        `<@&${mentionRole}> ${event.name}`
      );
    }
  }
});

setInterval(async () => {
  // Closeキューを処理
  Bot.db.query('SELECT * FROM `threadCloseQueue`', async (e: any, rows: any[]) => {
    if (!rows || !rows[0]) return;

    for (const row of rows) {
      if (row.date <= Date.now()) {
        const channel = client.channels.cache.get(row.channelId) as TextChannel;

        await channel.setName('空きチャンネル');
        await channel.setParent(config.thread.closedCategory);

        channel.send({
          embeds: [new MessageEmbed().setDescription('Closeされました。').setColor('RED')],
        });

        // スレッド一覧の埋め込み色を赤色にする
        Bot.db.query(
          'SELECT * FROM `threads` WHERE `channelId` = ? AND `closed` = ?',
          [row.channelId, false],
          (e, rows) => {
            (client.channels.cache.get(config.thread.createChannel) as TextChannel)?.messages
              .fetch(rows[0].listMessageId)
              .then((msg) => {
                msg.edit({
                  embeds: [msg.embeds[0].setColor('RED')],
                });
              });
          }
        );
        // Closeキューから削除
        Bot.db.query('DELETE FROM `threadCloseQueue` WHERE `channelId` = ?', [row.channelId]);
        // チャンネルを空きチャンネルとしてマーク
        Bot.db.query('UPDATE `threadChannels` SET `inUse` = ? WHERE `channelId` = ?', [
          false,
          row.channelId,
        ]);
        // スレッドをClose済としてマーク
        Bot.db.query('UPDATE `threads` SET `closed` = ? WHERE `channelId` = ? AND `closed` = ?', [
          true,
          row.channelId,
          false,
        ]);
      }
    }
  });

  // 2日間発言がないスレッドをCloseキューに追加
  const openChannels: any = (client.channels.cache.get(
    '756959797806366851'
  ) as CategoryChannel)!.children.map((channel: any) => channel);

  for (const channel of openChannels) {
    const lastMessageCollection = await channel.messages.fetch({ limit: 1 });
    const lastMessage: Message = lastMessageCollection.first();

    Bot.db.query('SELECT `threadCloseQueue` WHERE `channelId` = ?', [channel.id], (e, rows) => {
      if (!rows || !rows[0]) {
        if (lastMessage.createdTimestamp + 172800000 < Date.now()) {
          channel.send({
            embeds: [
              new MessageEmbed()
                .setDescription(
                  '2日間以上メッセージがないため、\n1時間後にCloseされます。\nメッセージを送信するとCloseをキャンセルできます。'
                )
                .setColor('RED'),
            ],
          });

          Bot.db.query('INSERT INTO `threadCloseQueue` (`channelId`, `date`) VALUES (?, ?)', [
            channel.id,
            new Date(Date.now() + 3600000),
          ]);
        }
      }
    });
  }
}, 600000);

setInterval(() => {
  Bot.db.query('SELECT * FROM `updateNotify`', async (e: any, rows: any[]) => {
    if (!rows || !rows[0]) return;

    const channel = client.channels.cache.get(config.upChannel) as TextChannel;

    for (const row of rows) {
      if (row.date <= Date.now()) {
        let updateCommand;
        if (row.boardType === 'disboard') {
          updateCommand = '!d bump';
        } else if (row.boardType === 'dissoku') {
          updateCommand = '/dissoku up';
        } else if (row.boardType === 'chahan') {
          updateCommand = 'c!up';
        } else if (row.boardType === 'glow') {
          updateCommand = 'g.toss';
        }

        channel.send({
          embeds: [
            new MessageEmbed()
              .setTitle('Upできます！')
              .setDescription(`\`${updateCommand}\` を送信してUpできます！`)
              .setColor('BLURPLE'),
          ],
        });

        Bot.db.query('DELETE FROM `updateNotify` WHERE `boardType` = ?', [row.boardType]);
      }
    }
  });
}, 10000);

const commandFiles = fs
  .readdirSync(path.resolve(__dirname, 'Commands'))
  .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./Commands/${file}`);
  Bot.commands.set(command.data.name, command);
}

const messageCommandFiles = fs
  .readdirSync(path.resolve(__dirname, 'MessageCommands'))
  .filter((file) => file.endsWith('.js'));

for (const file of messageCommandFiles) {
  const command = require(`./MessageCommands/${file}`);
  Bot.messageCommands.set(command.name, command);
}

const eventFiles = fs
  .readdirSync(path.resolve(__dirname, 'Events'))
  .filter((file) => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(`./Events/${file}`);
  if (event.once) {
    client.once(event.name, (...args: any) => event.execute(...args));
  } else {
    client.on(event.name, (...args: any) => event.execute(...args));
  }
}

client.login(process.env.DISCORD_TOKEN);
