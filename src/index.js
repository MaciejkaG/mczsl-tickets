import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REST, Routes, Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { createClient } from 'redis';
import chalk from 'chalk';
import mysql from 'mysql';
import tags from './utils/tags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
const token = process.env.bot_token;
const clientId = process.env.bot_client_id;

const redis = createClient();
redis.on('error', err => console.log(`${tags.redis} Client ${chalk.red('error')} occured:`, err));
await redis.connect();
console.log(`${tags.redis} Connected.`)

const mysqlConfig = {
    host: process.env.mysql_host,
    port: process.env.mysql_port ? parseInt(process.env.mysql_port) : 3306,
    user: process.env.mysql_user,
    password: process.env.mysql_pass,
    database: process.env.mysql_db,
    multipleStatements: true
};

// This does not work as intended (yet)
const conn = mysql.createConnection(mysqlConfig);
conn.query("SELECT version();", (err) => {
    if (err) console.log(`${tags.mysql} Client ${chalk.red('error')} occured:\n${err}`);
    else console.log(`${tags.mysql} Connected.`)
});
// conn.query("CREATE TABLE IF NOT EXISTS ticket_archive (ticket_id VARCHAR(32) PRIMARY KEY, author_id VARCHAR(32) NOT NULL, archive_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(), ticket_data JSON NOT NULL);CREATE TABLE user_profiles(user_id VARCHAR(32) PRIMARY KEY, profile_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP());CREATE TABLE `warns` (`id` uuid NOT NULL DEFAULT uuid() PRIMARY KEY, `user_id` varchar(32) NOT NULL, `by_user_id` varchar(32) NOT NULL, `reason` varchar(256) DEFAULT NULL, `date` timestamp NOT NULL DEFAULT current_timestamp());", () => {
//     conn.end();
// });

client.redis = redis;
client.commands = new Collection();

(async () => {
    console.log(`${tags.commands} Loading command handlers...`);
    for (const folder of commandFolders) {
        const commandsPath = path.join(foldersPath, folder);
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = (await import('file://' + filePath)).default;
            if (command && command.data && command.execute) {
                commands.push(command.data.toJSON());
                client.commands.set(command.data.name, command);
            } else {
                console.log(`${tags.commands} ${chalk.yellow('[WARNING]')} The command at ${filePath} is missing required property(-ies).`);
            }
        }
    }
    console.log(`${tags.commands} All command handlers loaded...`);

    const rest = new REST().setToken(token);

    try {
        console.log(`${tags.commands} Reloading ${commands.length} application (/) commands...`);

        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log(`${tags.commands} Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }

    console.log(`${tags.events} Loading event handlers...`);
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = (await import('file://' + filePath)).default;
        if (event && event.name && event.execute) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }
        } else {
            console.log(`${tags.events} ${chalk.yellow('[WARNING]')} The command at ${filePath} is missing required property(-ies).`);
        }
    }
    console.log(`${tags.events} All event handlers loaded...`);
})();

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.log(`${tags.commands} ${chalk.yellow('[WARNING]')} No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Wystąpił błąd w trakcie wykonywania tej komendy!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.login(token);