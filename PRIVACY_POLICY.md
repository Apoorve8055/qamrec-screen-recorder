### **Privacy Policy – Qamrec Screen Recorder**

**Last updated:** September 2026

Qamrec Screen Recorder is a free, open-source Chrome extension designed solely for screen and webcam recording.

#### Data Collection

Qamrec does **not collect, transmit, or share any personal or sensitive user data**.

#### Local Processing

* All screen, camera, and audio recordings are processed, analyzed, edited and encoded **locally in the user’s browser**
* Recorded files are saved **only on the user’s device**
* No data is uploaded to any server. Background blur runs a model bundled inside the extension; nothing is downloaded at runtime

#### Page Activity Tracking (for cinematic effects)

To zoom on clicks and show keystrokes, Qamrec injects a small script **only into the tab the user starts a recording from**, and only after the user clicks the extension.

* It reports pointer position, clicks, scrolling, the position of the focused text field, keyboard shortcuts and the page title — **only while recording** — to the extension's own recorder window
* **Typed text is never captured.** Plain characters typed into fields are reported only as "typing"; nothing at all is reported for password, payment or one-time-code fields
* This data stays in memory for the editing session and is never stored or sent anywhere

#### Permissions

* `activeTab`, `scripting` — inject the page activity tracker described above into the current tab
* `tabCapture` — record the current tab
* `downloads` — save exported recordings
* `storage` — remember settings and presets on this device

These permissions are used **only to enable recording, editing and saving files locally** and nothing else.

#### Third Parties

* No analytics
* No ads
* No trackers
* No third-party services

#### Contact

If you have questions about this privacy policy, contact:
**Apoorve Verma**
GitHub: [https://github.com/Apoorve8055](https://github.com/Apoorve8055)