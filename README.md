# Vibe - AI Website Builder

🎨 **give in to the vibe**

An AI-powered website builder that creates beautiful, functional Next.js applications from natural language prompts. Built with Next.js, OpenAI, Daytona sandboxes, and Tailwind CSS.

## ✨ Features

- 🤖 **AI Code Generation** - Powered by GPT-4o-mini for cost-efficient, high-quality code
- 🚀 **Live Preview** - Instant sandbox deployment with Daytona
- 📁 **Multi-File Projects** - Generates complete Next.js apps with components, types, and utilities
- 🔍 **Code Viewer** - Browse and explore generated files with syntax highlighting
- 🎨 **Beautiful UI** - Sleek black design with gradient accents
- ✅ **Auto-Debugging** - Preflight checks and automatic error fixing
- 🔄 **State-Based Navigation** - Single-page apps with dynamic view switching

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- OpenAI API key
- Daytona API key and URL

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/vibe.git
cd vibe
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file:
```env
OPENAI_KEY=your_openai_api_key_here
DAYTONA_KEY=your_daytona_api_key_here
DAYTONA_URL=your_daytona_url_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🎯 How It Works

1. **Enter Your Prompt** - Describe the website you want to build
2. **AI Generation** - GPT-4o-mini generates a complete Next.js project with multiple files
3. **Sandbox Deployment** - Project is deployed to a Daytona sandbox with live preview
4. **Preview & Edit** - View the live site and browse the generated code

### Architecture

```
User Prompt → OpenAI (Code Gen) → Daytona Sandbox → Live Preview
                                        ↓
                                  Preflight Tests
                                        ↓
                                  Auto-Debugging
                                        ↓
                                   npm run dev
```

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **AI**: OpenAI GPT-4o-mini
- **Sandboxes**: Daytona SDK
- **Language**: TypeScript
- **Icons**: FontAwesome

## 📝 Project Structure

```
├── app/
│   ├── api/
│   │   ├── generate/      # AI generation & sandbox creation
│   │   └── proxy/         # Preview URL proxy
│   ├── page.tsx           # Main landing page
│   └── globals.css        # Global styles
├── sandbox-templates/     # Template files for sandboxes
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── app/
│       └── layout.tsx
└── public/
    └── vibe_gradient.png  # Brand gradient image
```

## 🎨 Features in Detail

### AI Code Generation
- Generates 3-8 files per project
- Creates reusable components in separate files
- Includes TypeScript types and interfaces
- Follows Next.js 14 App Router conventions
- Uses state-based navigation (no additional routes)

### Preflight Testing
- TypeScript compilation checks
- Next.js linting
- Automatic error detection
- Up to 3 auto-fix attempts
- JSON wrapper detection and extraction

### Live Preview
- Public Daytona sandbox URLs
- Real-time preview in iframe
- Code viewer with file tree
- One-click "Open in New Tab"
- Refresh functionality

## 🔧 Configuration

### OpenAI Settings
- Model: `gpt-4o-mini` (cost-efficient)
- Max tokens: 6000
- Temperature: 0.7

### Sandbox Settings
- Image: `node:20-alpine`
- Public: `true`
- Environment: Next.js 14 with Tailwind CSS

## 📄 License

MIT

## 🙏 Acknowledgments

- OpenAI for GPT-4o-mini
- Daytona for sandbox infrastructure
- Next.js team for the amazing framework
- Tailwind CSS for styling utilities

---

**give in to the vibe** 🎨✨
