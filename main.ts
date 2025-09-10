import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface TranscriptionType {
    name: string;
    description: string;
    prompt: string;
}

interface AiNotesSettings {
	geminiApiKey: string;
	model: string;
    customTranscriptionTypes: TranscriptionType[];
}

const DEFAULT_SETTINGS: AiNotesSettings = {
	geminiApiKey: '',
	model: 'gemini-1.5-flash',
    customTranscriptionTypes: [],
}

export default class AiNotes extends Plugin {
	settings: AiNotesSettings;
	mediaRecorder: MediaRecorder | null = null;
	audioChunks: Blob[] = [];
	stream: MediaStream | null = null;
	currentTranscriptionTitle: string | null = null;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('microphone', 'AI Notes', () => {
			new RecordingChoiceModal(this.app, this).open();
		});

		this.addCommand({
			id: 'start-recording',
			name: 'Start recording',
			callback: () => {
				new RecordingChoiceModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'upload-recording',
			name: 'Upload recording',
			callback: () => {
				new RecordingChoiceModal(this.app, this).open();
			}
		});

		this.addSettingTab(new AiNotesSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	

	async generatePrompt(typeName: string): Promise<string> {
		const genAI = new GoogleGenerativeAI(this.settings.geminiApiKey);
		const model = genAI.getGenerativeModel({ model: this.settings.model });

		const prompt = `Generate a detailed prompt for a transcription service. The user wants to transcribe an audio and get a result of type '${typeName}'. The prompt should clearly instruct the AI on what to extract from the audio. For example, for a 'Meeting Summary' type, the prompt could be 'Transcribe the audio and provide a summary of the meeting, including key decisions and action items.'`;

		const result = await model.generateContent(prompt);
		return result.response.text();
	}

	async initRecording() {
		if (!this.settings.geminiApiKey) {
			new Notice('Please set your Gemini API key in the settings.');
			return false;
		}

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.mediaRecorder = new MediaRecorder(this.stream);
			this.audioChunks = [];

			this.mediaRecorder.addEventListener('dataavailable', event => {
				this.audioChunks.push(event.data);
			});

			this.mediaRecorder.addEventListener('stop', async () => {
				const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
				new TranscriptionTypeModal(this.app, this, audioBlob).open();
			});
			return true;
		} catch (error) {
			new Notice('Error initializing recording: ' + error.message);
			return false;
		}
	}

	start() {
		if (this.mediaRecorder) {
			this.mediaRecorder.start();
		}
	}

	stopRecording() {
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			this.mediaRecorder.stop();
		}
		if (this.stream) {
			this.stream.getTracks().forEach(track => track.stop());
			this.stream = null;
		}
	}

	async transcribe(audioBlob: Blob, prompt: string): Promise<string> {
		const genAI = new GoogleGenerativeAI(this.settings.geminiApiKey);
		const model = genAI.getGenerativeModel({ model: this.settings.model });

		const audioBase64 = await this.blobToBase64(audioBlob);

		const result = await model.generateContent([
			{
				inlineData: {
					mimeType: 'audio/webm',
					data: audioBase64,
				},
			},
			{ text: prompt },
		]);

		return result.response.text();
	}


	async transcribeAndSave(audioBlob: Blob, prompt: string) {
		const progress = new TranscriptionProgressModal(this.app, this);
		progress.open();
		progress.updateStatus('transcribing');

		try {
			const transcription = await this.transcribe(audioBlob, prompt);

			progress.updateStatus('saving');
			const folderPath = 'transcriptions';
			const providedTitle = (this.currentTranscriptionTitle ?? '').trim();
			const safeBase = providedTitle ? this.sanitizeFileName(providedTitle) : '';
			const baseName = safeBase && safeBase.length > 0 ? safeBase : `transcription-${Date.now()}`;
			const fileName = `${baseName}.md`;
			const filePath = `${folderPath}/${fileName}`;

			try {
				await this.app.vault.createFolder(folderPath);
			} catch (e) {
				// Folder already exists
			}

			const content = transcription;
			await this.app.vault.create(filePath, content);
			// Reset title after successful save
			this.currentTranscriptionTitle = null;
			progress.close();
			await this.app.workspace.openLinkText(filePath, '', false);
		} catch (error) {
			progress.updateStatus('error');
			new Notice('Error during transcription: ' + (error as Error).message);
			setTimeout(() => progress.close(), 1500);
		}
	}

	private sanitizeFileName(name: string): string {
		// Remove characters not allowed in Obsidian/FS filenames and trim spaces/dots
		const replaced = name
			.replace(/[\\/:*?"<>|]/g, '-')
			.replace(/\s+/g, ' ')
			.trim();
		// Avoid names that end with a dot or space
		return replaced.replace(/[ .]+$/g, '');
	}

	private blobToBase64(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const dataUrl = reader.result as string;
				const base64Data = dataUrl.split(',')[1];
				resolve(base64Data);
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}
}

class RecordingChoiceModal extends Modal {
	plugin: AiNotes;

	constructor(app: App, plugin: AiNotes) {
		super(app);
		this.plugin = plugin;
		this.modalEl.addClass('recording-choice-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv('recording-choice-container');

		const titleEl = container.createEl('h2', { text: 'AI Notes' });
		const subtitleEl = container.createEl('p', { text: 'Choose an option to get started' });

		// Title input
		const titleWrapper = container.createDiv('title-input-container');
		const titleLabel = titleWrapper.createEl('label', { text: 'Title (optional)', cls: 'title-label' });
		const titleInput = titleWrapper.createEl('input');
		titleInput.setAttr('type', 'text');
		titleInput.setAttr('placeholder', 'e.g., Team Meeting with Alex');
		titleInput.classList.add('title-input');
		titleInput.value = this.plugin.currentTranscriptionTitle ?? '';
		titleInput.addEventListener('input', (e: Event) => {
			const val = (e.target as HTMLInputElement).value;
			this.plugin.currentTranscriptionTitle = val;
		});

		const recordButton = container.createEl('button', { text: 'Start Recording', cls: 'mod-cta' });
		recordButton.addEventListener('click', async () => {
			this.close();
			new RecordingModal(this.app, this.plugin).open();
		});

		const uploadButton = container.createEl('button', { text: 'Upload Recording', cls: 'mod-cta upload-button' });
		uploadButton.addEventListener('click', async () => {
			this.handleFileUpload();
		});

		const poweredBy = contentEl.createDiv('powered-by');
		poweredBy.setText('Powered by nivio.ai');

		this.addStyles();

		// Remove background overlay for this modal only
		const modalContainer = this.modalEl.closest('.modal-container');
		if (modalContainer) modalContainer.classList.add('no-backdrop');
	}

	onClose() {
		// Restore the overlay if it was removed
		const modalContainer = this.modalEl.closest('.modal-container');
		if (modalContainer) modalContainer.classList.remove('no-backdrop');
		const { contentEl } = this;
		contentEl.empty();
	}

	async handleFileUpload() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'audio/*';
		input.style.display = 'none';

		input.onchange = async (event) => {
			const file = (event.target as HTMLInputElement).files?.[0];
			if (file) {
				const arrayBuffer = await file.arrayBuffer();
				const audioBlob = new Blob([arrayBuffer], { type: file.type });
				this.close();
				new TranscriptionTypeModal(this.app, this.plugin, audioBlob).open();
			}
		};

		document.body.appendChild(input);
		input.click();
		document.body.removeChild(input);
	}

	addStyles() {
		const existing = document.getElementById('recording-choice-modal-styles');
		if (existing) return;
		const style = document.createElement('style');
		style.id = 'recording-choice-modal-styles';
		style.innerHTML = `
			.recording-choice-modal .modal-content {
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 0;
				background: transparent;
			}
            /* Remove dark background overlay only for the RecordingChoiceModal */
            .modal-container.no-backdrop .modal-bg { display: none !important; }
			.recording-choice-container {
				display: flex;
				flex-direction: column;
				align-items: stretch;
				gap: 14px;
				text-align: left;
				padding: 22px 24px;
				min-width: 360px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 12px;
				background: color-mix(in oklab, var(--background-primary) 85%, transparent);
				backdrop-filter: blur(6px);
				box-shadow: 0 6px 18px rgba(0,0,0,0.18);
			}
			.recording-choice-container h2 {
				color: var(--text-normal);
				margin: 0;
				font-size: 1.15rem;
				font-weight: 600;
			}
			.recording-choice-container p {
				color: var(--text-muted);
				margin: 0 0 6px;
			}
			/* Title input */
			.title-input-container { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px; }
			.title-input-container .title-label { color: var(--text-muted); font-size: 0.85rem; }
			.title-input-container .title-input {
				width: 100%;
				padding: 8px 10px;
				border-radius: 8px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-normal);
				outline: none;
			}
			.title-input-container .title-input:focus { border-color: var(--interactive-accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--interactive-accent) 25%, transparent); }
			/* Buttons */
			.recording-choice-modal .mod-cta {
				background-color: var(--interactive-accent);
				color: var(--text-on-accent);
				border: none;
				padding: 10px 14px;
				border-radius: 8px;
				font-size: 0.95rem;
				cursor: pointer;
				transition: background-color 0.2s, transform 0.06s ease;
				width: 100%;
			}
			.recording-choice-modal .mod-cta:hover { background-color: var(--interactive-accent-hover); }
			.recording-choice-modal .mod-cta:active { transform: translateY(1px); }
			.recording-choice-modal .upload-button {
				background-color: color-mix(in oklab, var(--background-modifier-border) 90%, transparent);
				color: var(--text-normal);
			}
			.recording-choice-modal .upload-button:hover { background-color: var(--background-modifier-border-hover); }
			.powered-by {
				position: absolute;
				bottom: 10px;
				right: 12px;
				font-size: 0.7em;
				color: var(--text-muted);
			}
		`;
		document.head.appendChild(style);
	}

	removeStyles() {
		const style = document.getElementById('recording-choice-modal-styles');
		if (style) {
			style.remove();
		}
	}
}

class RecordingModal extends Modal {
	plugin: AiNotes;
	audioContext: AudioContext | null = null;
	analyser: AnalyserNode | null = null;
	source: MediaStreamAudioSourceNode | null = null;
	animationFrameId: number | null = null;
	timerIntervalId: number | null = null;
	seconds: number = 0;

	constructor(app: App, plugin: AiNotes) {
		super(app);
		this.plugin = plugin;
		this.modalEl.addClass('recording-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv('start-recording-container');

		const titleEl = container.createEl('h2', { text: 'Ready to Record?' });

		const microphoneIcon = container.createDiv('microphone-icon');
		microphoneIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mic">
				<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
				<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
				<line x1="12" x2="12" y1="19" y2="22"/>
			</svg>
		`;

		const startButton = container.createEl('button', { text: 'Start Recording', cls: 'mod-cta' });
		startButton.addEventListener('click', async () => {
			const success = await this.plugin.initRecording();
			if (success) {
				this.plugin.start();
				this.showRecordingUI();
			} else {
				this.close();
			}
		});

		const poweredBy = contentEl.createDiv('powered-by');
		poweredBy.setText('Powered by nivio.ai');

		this.addStyles();

		// Match TranscriptionType modal behavior: no backdrop
		const modalContainer = this.modalEl.closest('.modal-container');
		if (modalContainer) modalContainer.classList.add('no-backdrop');
	}

	async showRecordingUI() {
		try {
			const { contentEl } = this;
			contentEl.empty();

			const canvas = contentEl.createEl('canvas');
			canvas.width = 400;
			canvas.height = 150;
			const canvasCtx = canvas.getContext('2d');

			if (!canvasCtx) return;

			const timerEl = contentEl.createEl('p', { text: '00:00', cls: 'timer' });

			this.seconds = 0;
			this.timerIntervalId = window.setInterval(() => {
				this.seconds++;
				const minutes = Math.floor(this.seconds / 60).toString().padStart(2, '0');
				const seconds = (this.seconds % 60).toString().padStart(2, '0');
				timerEl.setText(`${minutes}:${seconds}`);
			}, 1000);

			this.audioContext = new AudioContext();
			if (!this.plugin.stream) return;
			this.source = this.audioContext.createMediaStreamSource(this.plugin.stream);
			this.analyser = this.audioContext.createAnalyser();
			this.source.connect(this.analyser);
			this.analyser.fftSize = 2048;

			const bufferLength = this.analyser.frequencyBinCount;
			const dataArray = new Uint8Array(bufferLength);

			const draw = () => {
				if (!this.analyser) return;
				this.animationFrameId = requestAnimationFrame(draw);

				this.analyser.getByteTimeDomainData(dataArray);

				canvasCtx.fillStyle = getComputedStyle(document.body).getPropertyValue('--background-secondary');
				canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

				canvasCtx.lineWidth = 2;
				canvasCtx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--text-accent');

				canvasCtx.beginPath();

				const sliceWidth = canvas.width * 1.0 / bufferLength;
				let x = 0;

				for (let i = 0; i < bufferLength; i++) {
					const v = dataArray[i] / 128.0;
					const y = v * canvas.height / 2;

					if (i === 0) {
						canvasCtx.moveTo(x, y);
					} else {
						canvasCtx.lineTo(x, y);
					}

					x += sliceWidth;
				}

				canvasCtx.lineTo(canvas.width, canvas.height / 2);
				canvasCtx.stroke();
			};

			draw();

			const stopButton = contentEl.createEl('button', { text: 'Stop Recording', cls: 'mod-cta' });
			stopButton.addEventListener('click', () => {
				this.plugin.stopRecording();
				if (this.animationFrameId) {
					cancelAnimationFrame(this.animationFrameId);
				}
				if (this.timerIntervalId) {
					window.clearInterval(this.timerIntervalId);
				}
				this.close();
			});

			const poweredBy = contentEl.createDiv('powered-by');
			poweredBy.setText('Powered by nivio.ai');

			this.addStyles();
		} catch (error) {
			new Notice('Error showing recording UI: ' + error.message);
			this.close();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.removeStyles();

		// Restore backdrop class if it was removed
		const modalContainer = this.modalEl.closest('.modal-container');
		if (modalContainer) modalContainer.classList.remove('no-backdrop');

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
		}
		if (this.audioContext) {
			this.audioContext.close();
		}
		if (this.timerIntervalId) {
			window.clearInterval(this.timerIntervalId);
		}
	}

	addStyles() {
		const style = document.createElement('style');
		style.id = 'recording-modal-styles';
		style.innerHTML = `
			/* Hide backdrop when container has no-backdrop (used by recording modal as well) */
			.modal-container.no-backdrop .modal-bg { display: none !important; }
			.recording-modal .modal-content {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				padding: 2em;
				background-color: var(--background-primary);
			}
			.start-recording-container {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				text-align: center;
			}
			.start-recording-container h2 {
				color: var(--text-normal);
				margin-bottom: 1em;
			}
			.microphone-icon {
				color: var(--text-accent);
				margin-bottom: 1.5em;
			}
			.recording-modal .mod-cta {
				background-color: var(--interactive-accent);
				color: var(--text-on-accent);
				border: none;
				padding: 10px 20px;
				border-radius: 5px;
				font-size: 1.2em;
				cursor: pointer;
				transition: background-color 0.3s;
			}
			.recording-modal .mod-cta:hover {
				background-color: var(--interactive-accent-hover);
			}
			.recording-modal canvas {
				margin-bottom: 1.5em;
				border-radius: 8px;
			}
			.timer {
				font-size: 1.5em;
				font-weight: 500;
				margin-bottom: 1em;
				color: var(--text-normal);
			}
			.powered-by {
				position: absolute;
				bottom: 10px;
				right: 10px;
				font-size: 0.7em;
				color: var(--text-muted);
			}
		`;
		document.head.appendChild(style);
	}

	removeStyles() {
		const style = document.getElementById('recording-modal-styles');
		if (style) {
			style.remove();
		}
	}
}

class GeneratingModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText('Generating...');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class TranscriptionProgressModal extends Modal {
    plugin: AiNotes;
    status: 'transcribing' | 'saving' | 'completed' | 'error' = 'transcribing';

    constructor(app: App, plugin: AiNotes) {
        super(app);
        this.plugin = plugin;
        this.modalEl.addClass('transcription-progress-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.updateContent();
    }

    updateContent() {
        const { contentEl } = this;
        contentEl.empty();

        const container = contentEl.createDiv('transcription-progress-container');

        const icon = container.createDiv('tp-icon');
        icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>`;

        const titleEl = container.createEl('h2', { text: 'Transcription in Progress' });

        const statusEl = container.createEl('p', { text: this.getStatusText(), cls: 'status-text' });

        const spinner = container.createDiv('spinner');

        const poweredBy = container.createDiv('powered-by');
        poweredBy.setText('Powered by nivio.ai');

        this.addStyles();

        // Remove background overlay for this modal only
        const modalContainer = this.modalEl.closest('.modal-container');
        if (modalContainer) modalContainer.classList.add('no-backdrop');
    }

    getStatusText(): string {
        switch (this.status) {
            case 'transcribing':
                return 'Transcribing your audio...';
            case 'saving':
                return 'Saving transcription...';
            case 'completed':
                return 'Completed!';
            case 'error':
                return 'An error occurred';
            default:
                return 'Processing...';
        }
    }

    updateStatus(status: 'transcribing' | 'saving' | 'completed' | 'error') {
        this.status = status;
        this.updateContent();
    }

    onClose() {
        // Restore backdrop class if it was removed
        const modalContainer = this.modalEl.closest('.modal-container');
        if (modalContainer) modalContainer.classList.remove('no-backdrop');
    }

    addStyles() {
        const existing = document.getElementById('transcription-progress-modal-styles');
        if (existing) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'transcription-progress-modal-styles';
        style.innerHTML = `
            /* Hide backdrop when container has no-backdrop (used by choice & progress modals) */
            .modal-container.no-backdrop .modal-bg { display: none !important; }
            .transcription-progress-modal .modal-content {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                background: transparent;
            }
            .transcription-progress-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                text-align: center;
                padding: 24px 28px 40px 28px;
                min-width: 320px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 12px;
                background: color-mix(in oklab, var(--background-primary) 85%, transparent);
                backdrop-filter: blur(6px);
                box-shadow: 0 6px 18px rgba(0,0,0,0.18);
                position: relative;
            }
            .transcription-progress-container .tp-icon svg {
                color: var(--text-accent);
            }
            .transcription-progress-container h2 {
                color: var(--text-normal);
                font-size: 1.1rem;
                margin: 2px 0 4px;
                font-weight: 600;
            }
            .status-text {
                color: var(--text-muted);
                margin: 0 0 8px;
                font-size: 0.95rem;
            }
            .spinner {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background:
                    conic-gradient(from 0deg, var(--interactive-accent) 0deg, transparent 300deg) content-box,
                    conic-gradient(from 0deg, var(--background-modifier-border) 0deg, transparent 300deg);
                -webkit-mask: radial-gradient(farthest-side, transparent 58%, #000 60%);
                mask: radial-gradient(farthest-side, transparent 58%, #000 60%);
                animation: spin 1s linear infinite;
                margin: 6px 0 2px;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .transcription-progress-container .powered-by {
                position: absolute;
                bottom: 10px;
                right: 12px;
                font-size: 0.7em;
                color: var(--text-muted);
            }
        `;
        document.head.appendChild(style);
    }

    removeStyles() {
        const style = document.getElementById('transcription-progress-modal-styles');
        if (style) {
            style.remove();
        }
    }
}


class TranscriptionTypeModal extends Modal {
	plugin: AiNotes;
	audioBlob: Blob;

	constructor(app: App, plugin: AiNotes, audioBlob: Blob) {
		super(app);
		this.plugin = plugin;
		this.audioBlob = audioBlob;
		this.modalEl.addClass('transcription-type-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Select Transcription Type' });

		const defaultTypes = [
			{ name: 'Simple', description: 'A plain transcription of the audio.', prompt: 'Transcribe the audio.' },
			{ name: 'Standard', description: 'Transcription with key takeaways and a summary.', prompt: 'Transcribe the audio. Also, extract key takeaways and a summary.' },
			{ name: 'Detailed', description: 'Transcription with takeaways, summary, action items, and questions.', prompt: 'Transcribe the audio. Also, extract key takeaways, a summary, action items, and a list of questions asked.' }
		];

		defaultTypes.forEach(type => {
			new Setting(contentEl)
				.setName(type.name)
				.setDesc(type.description)
				.addButton(button => button
					.setButtonText('Select')
					.onClick(() => {
						this.plugin.transcribeAndSave(this.audioBlob, type.prompt);
						this.close();
					}));
		});

		this.plugin.settings.customTranscriptionTypes.forEach(type => {
			new Setting(contentEl)
				.setName(type.name)
				.setDesc(type.description)
				.addButton(button => button
					.setButtonText('Select')
					.onClick(() => {
						this.plugin.transcribeAndSave(this.audioBlob, type.prompt);
						this.close();
					}));
		});

		const poweredBy = contentEl.createDiv('powered-by');
		poweredBy.setText('Powered by nivio.ai');

		this.addStyles();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.removeStyles();
	}

	addStyles() {
		const style = document.createElement('style');
		style.id = 'transcription-type-modal-styles';
		style.innerHTML = `
			.transcription-type-modal .modal-content {
				position: relative;
				background-color: var(--background-primary);
				padding-bottom: 30px;
			}
			.powered-by {
				position: absolute;
				bottom: 10px;
				right: 10px;
				font-size: 0.7em;
				color: var(--text-muted);
			}
		`;
		document.head.appendChild(style);
	}

	removeStyles() {
		const style = document.getElementById('transcription-type-modal-styles');
		if (style) {
			style.remove();
		}
	}
}

class AiNotesSettingTab extends PluginSettingTab {
	plugin: AiNotes;

	constructor(app: App, plugin: AiNotes) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Enter your Gemini API key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.geminiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.geminiApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Select the model to use for transcription')
			.addDropdown(dropdown => dropdown
				.addOption('gemini-1.5-flash', 'Gemini 1.5 Flash')
				.addOption('gemini-1.5-pro', 'Gemini 1.5 Pro')
				.addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
				.addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Custom Transcription Types')
			.setDesc('Create your own transcription types with custom prompts.')
			.setHeading();

		this.plugin.settings.customTranscriptionTypes.forEach((type, index) => {
			const typeContainer = containerEl.createDiv('custom-type-container');

			new Setting(typeContainer)
				.setName(`Type ${index + 1}`)
				.setHeading();

			new Setting(typeContainer)
				.setName('Name')
				.addText(text => text
					.setPlaceholder('e.g., Meeting Summary')
					.setValue(type.name)
					.onChange(async (value) => {
						this.plugin.settings.customTranscriptionTypes[index].name = value;
						await this.plugin.saveSettings();
					}));

			new Setting(typeContainer)
				.setName('Description')
				.addTextArea(text => {
					text.setPlaceholder('Enter a short description of this transcription type...')
						.setValue(type.description)
						.onChange(async (value) => {
							this.plugin.settings.customTranscriptionTypes[index].description = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.setAttr('rows', 3);
				});

			const promptSetting = new Setting(typeContainer)
				.setName('Prompt')
				.addTextArea(text => {
					text.setPlaceholder('Enter your custom prompt here...')
						.setValue(type.prompt)
						.onChange(async (value) => {
							this.plugin.settings.customTranscriptionTypes[index].prompt = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.setAttr('rows', 10);
				});

			const buttonContainer = typeContainer.createDiv({ cls: 'button-container' });

			buttonContainer.createEl('button', { text: 'Generate with AI' })
				.addEventListener('click', async () => {
					const generatingModal = new GeneratingModal(this.app);
					generatingModal.open();
					try {
						const generatedPrompt = await this.plugin.generatePrompt(type.name);
						this.plugin.settings.customTranscriptionTypes[index].prompt = generatedPrompt;
						await this.plugin.saveSettings();
						this.display();
					} catch (error) {
						new Notice('Error generating prompt: ' + error.message);
					} finally {
						generatingModal.close();
					}
				});

			buttonContainer.createEl('button', { text: 'Delete' })
				.addEventListener('click', async () => {
					this.plugin.settings.customTranscriptionTypes.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				});
		});

		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add New Type')
				.onClick(async () => {
					this.plugin.settings.customTranscriptionTypes.push({ name: '', description: '', prompt: '' });
					await this.plugin.saveSettings();
					this.display();
				}));

		this.addStyles();
	}

	addStyles() {
		const style = document.createElement('style');
		style.id = 'custom-transcription-styles';
		style.innerHTML = `
			.custom-type-container {
				border: 1px solid var(--background-modifier-border);
				border-radius: 8px;
				padding: 1em;
				margin-bottom: 1em;
			}
			.custom-type-container .setting-item {
				display: flex;
				align-items: flex-start;
			}
			.custom-type-container .setting-item-info {
				width: 20%;
			}
			.custom-type-container .setting-item-control {
				width: 80%;
			}
			.custom-type-container .setting-item-control textarea {
				width: 100%;
			}
			.custom-type-container .setting-item-control input[type="text"] {
				width: 100%;
			}
			.button-container {
				display: flex;
				justify-content: space-between;
				margin-top: 0.5em;
			}
		`;
		document.head.appendChild(style);
	}

	removeStyles() {
		const style = document.getElementById('custom-transcription-styles');
		if (style) {
			style.remove();
		}
	}
}