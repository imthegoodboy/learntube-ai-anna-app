# LearnTube AI Privacy Policy

Effective: August 23, 2026

LearnTube AI is an Anna App that turns a YouTube video or user-provided transcript into a personal study workspace.

## Data the app processes

- YouTube URLs and public caption text that you choose to submit.
- Transcripts and lesson content that you paste into the app.
- Generated notes, flashcards, quizzes, study progress, and mentor questions.

## How data is used

The app uses submitted content only to retrieve public captions, generate study materials, answer grounded questions, and save your study progress. AI generation is performed through the Anna platform using the model access attached to your Anna account.

## Storage and sharing

Lesson data and progress are saved through Anna Storage for your Anna account. The app does not operate a separate analytics service, advertising network, or developer-controlled user database. A submitted YouTube URL is used to request publicly available video metadata and captions; it is not sold or shared for advertising.

## Retention and deletion

Saved lessons remain in Anna Storage until you delete them in the app or remove the app data through Anna. Removing a lesson deletes its saved study workspace from the app's Anna Storage namespace.

## Third-party services

Use of Anna and YouTube remains subject to their respective terms and privacy policies. Captioned YouTube URLs are first resolved through YouTube's public caption interface. When YouTube blocks the Anna Agent's network, the bundled transcript helper may request the same public caption text through the keyless caption edge at `youtube-transcript.ai`; the submitted video ID is included in that request. LearnTube AI does not send lesson notes, mentor questions, saved progress, account details, or model credentials to that service and does not request a separate model API key.

## Contact

For privacy questions or support, open an issue in the public project repository: https://github.com/imthegoodboy/learntube-ai-anna-app/issues
