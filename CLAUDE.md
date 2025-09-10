# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin for AI-powered voice recording and transcription using Google's Gemini AI. The plugin allows users to record audio directly in Obsidian or upload audio files, then transcribe them using customizable transcription types with AI-generated summaries and insights.

## Development Commands

- **Development build**: `npm run dev` - Starts esbuild in watch mode for development
- **Production build**: `npm run build` - Type checks with TypeScript and builds for production using esbuild
- **Version management**: `npm run version` - Bumps version in manifest.json and versions.json, then stages for commit

## Architecture

### Core Plugin Structure
The main plugin class `AiNotes` in `main.ts` extends Obsidian's Plugin class and manages:
- Settings persistence (Gemini API key, model selection, custom transcription types)
- Audio recording using Web APIs (MediaRecorder, getUserMedia)
- Transcription via Google Generative AI SDK
- File management in the `transcriptions/` folder

### Key Components

**Modal Classes:**
- `RecordingChoiceModal` - Initial interface for starting recording or uploading files
- `RecordingModal` - Audio recording interface with waveform visualization
- `TranscriptionTypeModal` - Selection of transcription types (Simple, Standard, Detailed, or custom)
- `TranscriptionProgressModal` - Progress feedback during transcription
- `GeneratingModal` - Loading state for AI prompt generation

**Settings System:**
- `AiNotesSettingTab` - Configuration interface for API keys, models, and custom transcription types
- Custom transcription types with AI-generated prompts based on user-defined names
- Support for multiple Gemini models (1.5 Flash/Pro, 2.5 Flash/Pro)

### Data Flow
1. User initiates recording or file upload through ribbon icon or commands
2. Audio is captured/processed into Blob format
3. User selects transcription type (built-in or custom)
4. Audio blob + prompt sent to Gemini API for processing
5. Response saved as markdown file in `transcriptions/` folder with sanitized filename
6. File automatically opened in Obsidian workspace

## Build System

Uses esbuild for bundling with TypeScript compilation. The configuration:
- Entry point: `main.ts`
- Output: `main.js` (bundled for Obsidian plugin system)
- External dependencies include Obsidian API and CodeMirror packages
- Development builds include inline sourcemaps

## File Structure

- `main.ts` - Main plugin code with all classes and logic
- `manifest.json` - Plugin metadata for Obsidian
- `esbuild.config.mjs` - Build configuration
- `transcriptions/` - Auto-created folder for saving transcribed notes

## Key Dependencies

- `@google/generative-ai` - Google Gemini AI SDK for transcription
- `obsidian` - Core Obsidian API for plugin development
- TypeScript and esbuild for development toolchain

The plugin is self-contained in a single TypeScript file with comprehensive modal-based UI and integrated audio processing capabilities.