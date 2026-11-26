# Settings

Settings is one page. Every setting is a line: its name, and in words how it stands now. Press a line to open it where it stands. Under the words is one sentence that says what the setting does, then its controls.

- A change is saved as you leave the control, and the band at the bottom has its **Undo**. There is no Save button.
- A value that can't be saved stays in the box, and the line says why. Nothing is changed until it can.
- A setting that changed on another device since you opened the page is never overwritten: the line says so and shows what it is now.
- **Find a setting** searches names, words and what a setting does. Press a group's title to fold it; that is remembered on this device. A search opens what it finds.
- **Set where they act** names the place for what is changed elsewhere, such as Areas (on Habits) or Today's layout (on Today).

Addresses from before, such as `/settings/past-days`, open the line.

## Two things that ask

Everything acts at once with Undo, except what can't be undone:

- **Revoke** a key. Anything that uses it stops working.
- **Replace my data** with a backup. What is here is downloaded first; if that download fails, nothing is replaced. A backup you restore keeps your login, keys and reminder devices.

## Backups

**Download your data** has **Everything (JSON)**, a full backup that can be restored here or on another server, and **Tables (CSV)** for a spreadsheet. See [Integrations](integrations.md#export-and-import) for what is in them. **Restore from a backup** reads the file you pick, says what it holds, and changes nothing until you confirm.

### Automatic backups

**Automatic backups** writes a copy of the whole database to a folder on the server: habits, Tasks, logs, notes, settings, your login and keys. The app keeps running while it copies, and the copy is consistent.

- **How often**: **Off**, **Every hour**, **Every 6 hours**, **Every day** or **Every week**. The time counts from the last copy, so a server that was off makes one as soon as it is back.
- **Folder on the server**: a whole path, starting with `/`, on the computer the app runs on. It is checked when you save it, and with copies on the first copy is made at once, so the line says straight away whether copies can be made there. In Docker, use `/data/backups` (the default) or a folder you mounted; a folder inside the container itself is refused, because rebuilding the app would delete it.
- **Copies to keep**: the newest this many stay, and older copies in that folder are deleted. Only files named like a copy (`ittracks-backup-2026-11-26T15-13-04Z.db`, the time in UTC) are ever counted or deleted.
- **Back up now** makes a copy at once, whether or not copies are on: before an update, for example.

The line says when the last copy was made and how big it is, or why the last try failed. A failed try is tried again an hour later. When a folder that held copies is missing, as when its drive is not connected, nothing is written and the line says so; the app never makes that folder again by itself.

To put a copy back, stop the app, delete `ittracks.db-wal` and `ittracks.db-shm`, and put the copy in place of `ittracks.db`. See [Restore](private-server.md#restore). **Restore from a backup** above is for JSON exports, not for these copies.

These settings belong to the server, not to your data: they are not in an export, and restoring an export doesn't change them.

## Logging out

Changes made offline wait on your device until the server has them. **Log out** names what is still waiting and offers **Save them, then log out**. Logged out anyway, they stay on the device and are sent when you sign in there again. They belong to your account: someone else who signs in on the same device never sends them.
