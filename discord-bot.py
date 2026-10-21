import os
import discord
from dotenv import load_dotenv

load_dotenv()

intents = discord.Intents.default()
intents.message_content = True  # needed to read message text

client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"Logged in as {client.user}")

@client.event
async def on_message(message: discord.Message):
    if message.author == client.user:
        return

    # Example: let your local Pi service handle it
    if message.content.startswith("!pi"):
        prompt = message.content.removeprefix("!pi").strip()
        reply = f"Received: {prompt}"  # replace with your local logic
        await message.channel.send(reply)

client.run(os.environ["DISCORD_BOT_TOKEN"])