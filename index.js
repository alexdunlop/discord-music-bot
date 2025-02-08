require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { Player } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const playdl = require('play-dl');
const ffmpeg = require('fluent-ffmpeg');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Create the player
const player = new Player(client, {
  bufferingTimeout: 5000, // Increase buffer timeout to 5 seconds
  connectionTimeout: 30000, // Allow more time to establish connections
  smoothVolume: true, // Enable smooth volume changes
});

// Register the YouTube extractor
player.extractors.register(YoutubeiExtractor, {});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
});

async function createBufferedStream(track) {
  const playStream = await playdl.stream(track.url, { quality: 2 });

  const ffmpegStream = ffmpeg(playStream.stream)
    .inputFormat('webm') // Input from YouTube is typically in WebM
    .audioCodec('libopus') // Discord prefers Opus codec
    .format('opus') // Ensure Opus output
    .on('error', (err) => console.error('[FFMPEG ERROR]', err));

  return ffmpegStream;
}

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  const voiceChannel = message.member?.voice?.channel;

  switch (command) {
    case '!play': {
      if (!voiceChannel) {
        return message.reply('❌ You must be in a voice channel to play music!');
      }

      const query = args.join(' ');
      if (!query) {
        return message.reply('❌ Please provide a song name or YouTube URL.');
      }

      try {
        const searchResult = await player.search(query, {
          requestedBy: message.author,
        });

        if (!searchResult || !searchResult.tracks.length) {
          return message.reply('❌ No results found!');
        }

        const queue = await player.nodes.create(message.guild, {
          metadata: {
            channel: message.channel,
          },
          leaveOnEmptyCooldown: 300000, // Leave the channel after 5 minutes of inactivity
          async onBeforeCreateStream(track, source, _queue) {
            if (source === 'youtube') {
              console.log('Buffering audio with FFmpeg...');
              return createBufferedStream(track);
            }
          },
        });

        if (!queue.connection) await queue.connect(voiceChannel);

        queue.addTrack(searchResult.tracks[0]);

        if (!queue.isPlaying()) queue.node.play();

        message.reply(`🎶 Now playing: **${searchResult.tracks[0].title}**`);
      } catch (error) {
        console.error('[ERROR] Failed to play:', error);
        message.channel.send('❌ An error occurred while trying to play the music.');
      }
      break;
    }

    case '!stop': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || !queue.isPlaying()) {
        return message.reply('❌ No music is currently playing.');
      }

      queue.delete(); // Stops and clears the queue
      message.reply('⏹ Music stopped and queue cleared!');
      break;
    }

    case '!skip': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || !queue.isPlaying()) {
        return message.reply('❌ No music is currently playing.');
      }

      const currentTrack = queue.currentTrack;
      queue.node.skip(); // Skips the current track
      message.reply(`⏭ Skipped **${currentTrack.title}**!`);
      break;
    }

    case '!pause': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || !queue.isPlaying()) {
        return message.reply('❌ No music is currently playing.');
      }

      if (queue.node.isPaused()) {
        return message.reply('⏸ The music is already paused.');
      }

      queue.node.setPaused(true); // Pauses playback
      message.reply('⏸ Music paused!');
      break;
    }

    case '!resume': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || !queue.node.isPaused()) {
        return message.reply('❌ The music is not paused.');
      }

      queue.node.setPaused(false); // Resumes playback
      message.reply('▶ Music resumed!');
      break;
    }

    case '!queue': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || queue.tracks.size === 0) {
        return message.reply('❌ The queue is empty.');
      }

      const queueString = queue.tracks
        .toArray()
        .map((track, index) => `${index + 1}. **${track.title}** (${track.duration})`)
        .join('\n');

      message.reply(`🎶 **Current Queue:**\n${queueString}`);
      break;
    }

    case '!shuffle': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || queue.tracks.size === 0) {
        return message.reply('❌ The queue is empty.');
      }

      queue.tracks.shuffle(); // Shuffles the queue
      message.reply('🔀 Queue shuffled!');
      break;
    }

    case '!nowplaying': {
      const queue = player.nodes.get(message.guild.id);
      if (!queue || !queue.currentTrack) {
        return message.reply('❌ No music is currently playing.');
      }
    
      const currentTrack = queue.currentTrack;
    
      // Get elapsed time and total duration
      const elapsed = queue.node.streamTime; // Time in milliseconds
      const totalDuration = currentTrack.durationMS; // Duration in milliseconds
    
      const progress = new Date(elapsed).toISOString().substr(11, 8); // Format as HH:MM:SS
      const duration = new Date(totalDuration).toISOString().substr(11, 8); // Format as HH:MM:SS
    
      message.reply(
        `🎶 **Now Playing:**\n**${currentTrack.title}**\nProgress: **${progress} / ${duration}**`
      );
      break;
    }
    

    case '!help': {
      const helpMessage = `
**Music Bot Commands** 🎵
> **!play <query/URL>** - Plays a song or adds it to the queue.
> **!stop** - Stops the music and clears the queue.
> **!skip** - Skips the current song.
> **!pause** - Pauses the current song.
> **!resume** - Resumes the paused song.
> **!queue** - Displays the current queue.
> **!nowplaying** - Shows the currently playing song.
> **!shuffle** - Shuffles the current queue.
> **!help** - Displays this help message.
      `;
      message.reply(helpMessage);
      break;
    }

    default:
      break; // Unknown commands are ignored
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
