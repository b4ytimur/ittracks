# Private server with Tailscale

Run your own ittracks on a Mac, a home server or a small VPS, and reach it only from your own devices. [Tailscale](https://tailscale.com) puts your devices on a private network of their own (your *tailnet*), and Tailscale Serve gives the app an HTTPS address on it, such as `https://habits.tail1234.ts.net`. Nothing is opened to the internet: the app listens only on the server itself, and only devices signed in to your tailnet can reach the address.

HTTPS matters because phones add the app to the Home Screen and send reminders only over HTTPS.

The Tailscale steps follow Tailscale's documentation as of November 2026. If a label has moved, their pages on [Serve](https://tailscale.com/docs/features/tailscale-serve) and [HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates) have the current one.

## What you need

- A machine that stays on, with Docker: Docker Desktop on a Mac, Docker Engine with the Compose plugin on Linux. It also needs git.
- A free Tailscale account, and the Tailscale app on the server and on every phone and computer you'll use ittracks from.

| Machine | Good for | Watch out for |
| --- | --- | --- |
| Mac | Trying it on a computer you already leave on | While it sleeps or is away, the app can't be reached and reminders don't go out |
| Home server | Always on, and the data stays at home | A power or internet cut at home |
| Small VPS | Always on, wherever you are | The data sits on a rented machine. Close its firewall (see [On a VPS](#on-a-vps)) |

## 1. Set up Tailscale

1. Install Tailscale on the server and sign in.
   - **Mac**: Tailscale recommends its Standalone app from [pkgs.tailscale.com](https://pkgs.tailscale.com/stable/#macos); the Mac App Store app works too. To get the `tailscale` command with the Standalone app (macOS 13 or later), open Tailscale's **Settings**, find **CLI integration**, press **Show me how**, then **Install Now**. With the App Store app, add `alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"` to `~/.zshrc` instead.
   - **Linux** (home server or VPS): run `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up`, and open the link it prints to sign in.
2. Install Tailscale on your phone and your other computers, and sign in with the same account.
3. In the [admin console](https://console.tailscale.com/admin/machines), give the server a name that says nothing about you, such as `habits`, from its **⋯** menu on the Machines page. The name becomes part of the app's address, and the next step publishes it.
4. On the [DNS page](https://console.tailscale.com/admin/dns), turn on **MagicDNS** if it is off, then under **HTTPS Certificates** select **Enable HTTPS**. Tailscale asks you to acknowledge that your machine names and your tailnet's DNS name will be published in a public certificate log. That log holds the address's name only: the app and your data stay private.

If you skip step 4, the command in the next section offers a link to turn HTTPS on.

## 2. Give the app an address

On the server (on Linux, put `sudo` in front of every `tailscale` command):

```sh
tailscale serve --bg 3000
```

It prints the app's address:

```text
Available within your tailnet:

https://habits.tail1234.ts.net/
|-- proxy http://127.0.0.1:3000
```

Tailscale now passes HTTPS requests from your tailnet to port 3000 on the server itself, with a certificate Tailscale provides. `--bg` keeps this running after you close the terminal, and brings it back after a restart. Until the app runs (next section), the address answers with an error.

## 3. Install and start ittracks

```sh
git clone https://github.com/b4ytimur/ittracks.git
cd ittracks
mkdir data
```

In that folder, make a file named `.env` (for example with `nano .env`) holding these two lines, with the address from section 2 and no slash at the end:

```sh
BIND_ADDRESS=127.0.0.1
ORIGIN=https://habits.tail1234.ts.net
```

- `BIND_ADDRESS=127.0.0.1` makes Docker open the app's port on the server itself only, where Tailscale reaches it. Without it, Docker opens port 3000 on every network the machine is on. On a VPS that is the internet, and Docker's ports get past firewalls such as ufw.
- `ORIGIN` is the address you open the app at. Signing in, links and the AI assistant setup use it.

Then start it:

```sh
docker compose up -d --build
```

The first build takes a few minutes. Open the address on any device in your tailnet, and create the account for your server.

Open the app at its `https://…ts.net` address only, on the server too. At `http://localhost:3000` the pages load, but signing in and saving fail, because the address doesn't match `ORIGIN`.

`.env` and `data` are yours: git ignores both, so [updates](#updates) never touch them.

### On a Mac

- In Docker Desktop, open **Settings → General** and turn on **Start Docker Desktop when you sign in to your computer**. Once Docker runs, the app starts by itself. Docker Desktop runs only while you are signed in to the Mac, so stay signed in.
- Keep the Mac awake: in **System Settings → Energy**, turn on **Prevent automatic sleeping when the display is off**. On a laptop it is under **Battery → Options…**, and works only on the power adapter. A closed lid still puts most laptops to sleep.

### On a VPS

With `BIND_ADDRESS=127.0.0.1` the app's port is closed to the internet, but the VPS still answers SSH there. In your provider's firewall, allow nothing in except SSH. Once Tailscale runs on the VPS, you can SSH to its tailnet name instead (`ssh you@habits`) and close SSH to the internet too. Keep the provider's web console as a way back in, in case Tailscale stops.

## 4. Check that nothing is public

- `docker compose ps` shows the port as `127.0.0.1:3000->3000/tcp`. If it shows `0.0.0.0:3000`, `.env` wasn't read: check its name and folder, then run `docker compose up -d`.
- `tailscale serve status` shows your address and the proxy to `http://127.0.0.1:3000`.
- Never run `tailscale funnel` for this app. Funnel is the Tailscale feature that puts a service on the public internet; Serve keeps it in your tailnet.
- On your phone, turn Tailscale off and open the address in a private browser tab: it should not load. (A private tab, because the installed app keeps an offline copy of pages it has shown.)
- On a VPS, from a device that isn't in your tailnet, `http://<the VPS's public IP>:3000` should not load either.

Every device in your tailnet can reach the sign-in page, and your ittracks password protects the rest. In a personal tailnet those are only your devices. If you share the machine or invite people to your tailnet, Tailscale's [private server guide](https://tailscale.com/docs/solutions/host-private-server-docker) shows how to limit who can reach it.

## Your phone

1. Install Tailscale, sign in, and turn it on.
2. Open the address. On iPhone and iPad, in Safari, press Share, then **Add to Home Screen**, and from now on open ittracks from its Home Screen icon. On Android, in Chrome's menu, choose **Add to Home screen** or **Install app**.

On iPhone and iPad, while Tailscale is on it stays connected through restarts and updates (Tailscale's VPN On Demand). Don't add **VPN On Demand** rules of your own: they replace that, and a rule such as **Never** disconnects Tailscale, so the app can't reach your server.

Without a connection to your tailnet, the app behaves as it does offline: pages it has shown still open, and what you log waits on the phone and is sent once it reaches the server ([Logging](logging.md#the-log-screen)).

### Reminders

Reminders need HTTPS, which the address gives them. They haven't been tested over Tailscale yet, so try one when you set up:

1. In the app opened from the Home Screen, go to **Settings → Reminders**, press **Turn on**, and allow notifications.
2. Press **Send a test**.

How a reminder travels: the server hands it to Apple's or Google's push service, which delivers it to the phone. So it arrives even while the phone's Tailscale is off, as long as the server can reach the internet. The **Done**, **Minimum** and **Snooze** buttons on it call your server, so they need Tailscale connected; when the server can't be reached, pressing one opens the app instead.

Reminders go out only while the server runs. One the server missed by more than two hours (a Mac that slept, say) is dropped, not sent late.

If the test doesn't arrive: on iPhone, check you opened the app from its Home Screen icon and not in Safari, and that **Settings → Notifications → ittracks** allows notifications. Then look for errors with `docker compose logs ittracks`.

## AI assistants (MCP)

The MCP server is a file that runs on the computer where your assistant runs (Claude Desktop, Claude Code, Cursor), not on the ittracks server. So that computer needs Tailscale too. Set it up as in [Integrations](integrations.md#set-it-up), with your address as `ITTRACKS_URL`:

```sh
claude mcp add ittracks -e ITTRACKS_URL=https://habits.tail1234.ts.net -e ITTRACKS_KEY=itk_… -- node /path/to/ittracks-mcp.mjs
```

**Settings → AI assistants** fills in the address for you, because it comes from `ORIGIN`.

Claude on the web and in the phone apps can't reach a tailnet. Don't use Tailscale Funnel to get around that: it would make your server public.

## Data and backups

Everything is in the `data` folder next to `docker-compose.yml`. `ittracks.db` holds your habits, logs, notes and settings, your login and keys, and the server's push keys. While the app runs, `ittracks.db-wal` and `ittracks.db-shm` sit next to it.

The app writes to the database while it runs, so a copy of `ittracks.db` alone, taken then, can miss changes or be broken. Back up one of these two ways.

With the app stopped, copy the whole folder:

```sh
docker compose stop
cp -R data ~/ittracks-backup-$(date +%F)
docker compose start
```

With the app running, let it write a consistent copy into `data`:

```sh
docker compose exec ittracks node -e "require('better-sqlite3')('/data/ittracks.db').backup('/data/backup-$(date +%F).db')"
```

Then move the copy off the machine: to another computer, a drive, or cloud storage. On Linux the file belongs to root, so move it with `sudo mv`. Time Machine and other file backups are fine for these copies; don't count on them for the live database.

To back up every night on Linux, put that command (with `-T` after `exec`) in a script that starts with `cd` to the ittracks folder, and run the script from cron.

**Settings → Data → Everything (JSON)** is another backup: your account's data, which imports on any ittracks server. It leaves out your login, keys and reminder devices, so it suits moving to a new server more than restoring this one. See [Export and import](integrations.md#export-and-import).

### Restore

```sh
docker compose stop
rm -f data/ittracks.db-wal data/ittracks.db-shm
cp ~/backups/backup-2026-11-26.db data/ittracks.db
docker compose start
```

Delete the `-wal` and `-shm` files first: they belong to the database you are replacing. On Linux, put `sudo` in front of `rm` and `cp`.

## Updates

Back up first, then:

```sh
cd ittracks
git log --oneline -1          # note the version you are on
git pull
docker compose up -d --build
docker compose logs --tail 20 ittracks
```

Database changes run by themselves when the app starts. `docker image prune` frees the space old builds take.

An update can change the database so that an older version can't read it. To go back, use both the older code and the backup from before the update: `git checkout <the version you noted>`, [restore](#restore) the backup, and run `docker compose up -d --build`. `git checkout main` returns to the latest version later.

## Turn it off

- Stop the app: `docker compose down`. The `data` folder stays.
- Stop the address: `tailscale serve --https=443 off`, or `tailscale serve reset` to clear all of Tailscale Serve's settings on that machine.

## When something is wrong

| What you see | What to do |
| --- | --- |
| Signing in does nothing, or "Cross-site POST form submissions are forbidden" | You opened the app at an address other than `ORIGIN`. Use the `ts.net` address, or correct `.env` and run `docker compose up -d` |
| The address doesn't load at all | Check Tailscale is on, on that device, and that MagicDNS is on in the admin console |
| The address answers with an error | Check the app runs: `docker compose ps`, then `docker compose logs ittracks` |
| A certificate warning | Check **Enable HTTPS** on the admin console's DNS page |
| A change to `.env` has no effect | Run `docker compose up -d`. A restart alone keeps the old settings |
