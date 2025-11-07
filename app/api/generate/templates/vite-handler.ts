import type { Sandbox } from '@daytonaio/sdk';
import { getTemplateFiles } from '@/lib/templates'

/**
 * Vite-specific handler for project generation
 */
export class ViteHandler {
  private templateConfig = {
    id: 'vite-react',
    name: 'Vite + React + TypeScript',
    description: 'Fast React development with Vite, TypeScript, and Tailwind CSS',
    templatePath: 'templates/vite',
    systemPromptPath: 'app/api/generate/systemPrompt-vite.ts',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
    buildDir: 'dist'
  }

  /**
   * Detect if project is DeFi/Web3 related based on user prompt
   */
  private isDefiProject(userPrompt: string): boolean {
    const defiKeywords = [
      'defi', 'web3', 'blockchain', 'crypto', 'ethereum', 'uniswap', 
      'aave', 'compound', 'staking', 'liquidity', 'pool', 'swap', 
      'token', 'nft', 'dao', 'dex', 'wallet', 'lending', 'borrowing',
      'yield', 'farming', 'bridge', 'dapp', 'smart contract'
    ]
    const lowerPrompt = userPrompt.toLowerCase()
    return defiKeywords.some(keyword => lowerPrompt.includes(keyword))
  }

  /**
   * Analyze generated files to find which library components are imported
   */
  private getUsedLibraryComponents(generatedFiles: Array<{ path: string; content: string }>, isDefi: boolean): Set<string> {
    const usedComponents = new Set<string>()
    const standardComponentNames = [
      'Header', 'HeaderSimple', 'Hero', 'HeroCentered', 'HeroSplit', 
      'Footer', 'FeatureCard', 'StatCard', 'TestimonialCard', 
      'PricingCard', 'CTA', 'CTACard', 'FAQ', 'BlogCard', 'ProductCard',
      'TeamCard', 'LogoCloud', 'ContactForm', 'NewsletterForm',
      'Steps', 'Gallery', 'Timeline', 'Section'
    ]
    const defiComponentNames = [
      'TokenBalance', 'SwapInterface', 'StakingCard', 'LiquidityPoolTable',
      'LendingInterface', 'WalletConnect'
    ]
    
    const allComponentNames = isDefi 
      ? [...standardComponentNames, ...defiComponentNames]
      : standardComponentNames

    for (const file of generatedFiles) {
      const content = file.content
      for (const componentName of allComponentNames) {
        // Check for import statements like: import { ComponentName } from "@/components/lib/ComponentName"
        const importPattern = new RegExp(`import\\s+{[^}]*\\b${componentName}\\b[^}]*}\\s+from\\s+["']@/components/lib/${componentName}["']`, 'g')
        if (importPattern.test(content)) {
          usedComponents.add(componentName)
        }
      }
    }

    return usedComponents
  }

  /**
   * Upload only used library components to the sandbox
   * @param sandbox - The sandbox
   * @param generatedFiles - Generated files to analyze for component usage
   * @param userPrompt - User's original prompt to detect DeFi projects
   */
  async uploadUsedLibraryComponents(sandbox: Sandbox, generatedFiles: Array<{ path: string; content: string }>, userPrompt: string = '') {
    const templateFiles = getTemplateFiles(this.templateConfig)
    const isDefi = this.isDefiProject(userPrompt)
    const usedComponents = this.getUsedLibraryComponents(generatedFiles, isDefi)
    
    console.log(`📦 Uploading ${usedComponents.size} used library components: ${Array.from(usedComponents).join(', ')}`)
    
    // Ensure lib folder exists
    await sandbox.fs.createFolder('/workspace/src/components/lib', '755')
    
    const usedComponentsArray = Array.from(usedComponents)
    for (const componentName of usedComponentsArray) {
      const filePath = `src/components/lib/${componentName}.tsx`
      if (templateFiles[filePath]) {
        const relativePath = filePath.replace('src/', '')
        await sandbox.fs.uploadFile(
          Buffer.from(templateFiles[filePath]), 
          `/workspace/src/${relativePath}`
        )
        console.log(`  ✅ Uploaded ${componentName}`)
      } else {
        console.log(`  ⚠️ Component ${componentName} not found in template`)
      }
    }
  }

  /**
   * Setup the Vite project in the sandbox
   */
  async setupProject(sandbox: Sandbox) {
    console.log('📦 Setting up Vite + React project...')
    
    // Get template files
    const templateFiles = getTemplateFiles(this.templateConfig)
    
    // Upload template configuration files
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['package.json']), 
      '/workspace/package.json'
    )
    
    if (templateFiles['vite.config.ts']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['vite.config.ts']), 
        '/workspace/vite.config.ts'
      )
    }
    
    const tailwindConfig = templateFiles['tailwind.config.ts']
    if (!tailwindConfig) {
      throw new Error('Tailwind config (tailwind.config.ts) not found in Vite template')
    }

    await sandbox.fs.uploadFile(
      Buffer.from(tailwindConfig), 
      '/workspace/tailwind.config.ts'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['postcss.config.js']), 
      '/workspace/postcss.config.js'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['tsconfig.json']), 
      '/workspace/tsconfig.json'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['tsconfig.app.json']), 
      '/workspace/tsconfig.app.json'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['tsconfig.node.json']), 
      '/workspace/tsconfig.node.json'
    )
    
    if (templateFiles['components.json']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['components.json']), 
        '/workspace/components.json'
      )
    }
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['index.html']), 
      '/workspace/index.html'
    )

    // Create project structure
    await sandbox.fs.createFolder('/workspace/src', '755')
    await sandbox.fs.createFolder('/workspace/src/components', '755')
    await sandbox.fs.createFolder('/workspace/src/components/ui', '755')
    await sandbox.fs.createFolder('/workspace/src/components/lib', '755')
    await sandbox.fs.createFolder('/workspace/src/pages', '755')
    await sandbox.fs.createFolder('/workspace/src/lib', '755')
    await sandbox.fs.createFolder('/workspace/src/hooks', '755')
    await sandbox.fs.createFolder('/workspace/src/types', '755')
    await sandbox.fs.createFolder('/workspace/src/utils', '755')
    await sandbox.fs.createFolder('/workspace/public', '755')

    // Upload template source files
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['src/main.tsx']), 
      '/workspace/src/main.tsx'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['src/App.tsx']), 
      '/workspace/src/App.tsx'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['src/index.css']), 
      '/workspace/src/index.css'
    )
    
    // Upload lib/utils.ts
    if (templateFiles['src/lib/utils.ts']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['src/lib/utils.ts']), 
        '/workspace/src/lib/utils.ts'
      )
    }
    
    // Upload hooks
    if (templateFiles['src/hooks/use-mobile.ts']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['src/hooks/use-mobile.ts']), 
        '/workspace/src/hooks/use-mobile.ts'
      )
    }
    
    // Upload ErrorBoundary component (required for error handling)
    if (templateFiles['src/components/ErrorBoundary.tsx']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['src/components/ErrorBoundary.tsx']), 
        '/workspace/src/components/ErrorBoundary.tsx'
      )
    }
    
    if (templateFiles['src/hooks/use-toast.ts']) {
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles['src/hooks/use-toast.ts']), 
        '/workspace/src/hooks/use-toast.ts'
      )
    }

    // Upload default pages so the landing view is never empty
    const pageFiles = Object.keys(templateFiles).filter(path => path.startsWith('src/pages/'))
    for (const filePath of pageFiles) {
      const relativePath = filePath.replace('src/', '')
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles[filePath]),
        `/workspace/src/${relativePath}`
      )
    }

    // Detect which non-UI components are actually imported by template pages/App
    const filesToScan = ['src/App.tsx', ...pageFiles]
    const componentImportRegex = /from\s+['"]@\/components\/([^'"]+)['"]/g
    const requiredComponentPaths = new Set<string>()

    for (const filePath of filesToScan) {
      const content = templateFiles[filePath]
      if (!content) continue

      let match: RegExpExecArray | null
      while ((match = componentImportRegex.exec(content)) !== null) {
        const importPath = match[1]
        if (importPath.startsWith('ui/')) {
          // UI components handled separately below
          continue
        }
        requiredComponentPaths.add(importPath)
      }
    }

    for (const importPath of Array.from(requiredComponentPaths)) {
      const candidates = [
        `src/components/${importPath}.tsx`,
        `src/components/${importPath}.ts`,
        `src/components/${importPath}/index.tsx`,
        `src/components/${importPath}/index.ts`
      ]

      const resolved = candidates.find(candidate => Boolean(templateFiles[candidate]))
      if (!resolved) {
        console.warn(`⚠️ Template component not found for import ${importPath}`)
        continue
      }

      const relativePath = resolved.replace('src/', '')
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles[resolved]!),
        `/workspace/src/${relativePath}`
      )
    }
    
    // DO NOT create lib folder - AI will create components inline
    // Upload all UI components (shadcn/ui - these are always needed)
    const uiComponentFiles = Object.keys(templateFiles).filter(
      path => path.startsWith('src/components/ui/')
    )
    
    for (const filePath of uiComponentFiles) {
      const relativePath = filePath.replace('src/', '')
      await sandbox.fs.uploadFile(
        Buffer.from(templateFiles[filePath]), 
        `/workspace/src/${relativePath}`
      )
    }
    
    // Additional library components will be uploaded later via uploadUsedLibraryComponents()
  }

  /**
   * Build the project
   */
  async buildProject(sandbox: Sandbox) {
    console.log('🔨 Building Vite project...')
    await sandbox.process.executeCommand('cd /workspace && npm run build')
  }

  /**
   * Get build files
   */
    async getBuildFiles(sandbox: Sandbox): Promise<Array<{ path: string; content: Buffer }>> {
    const listResult = await sandbox.process.executeCommand('cd /workspace && find dist -type f')
    
    if (!listResult.result) {
      throw new Error('Build produced no files')
    }

    const buildFiles = listResult.result
      .trim()
      .split('\n')
      .filter(f => f && f.startsWith('dist/'))

    console.log(`Found ${buildFiles.length} build files`)

    // Download all build files
    const filesToUpload: Array<{ path: string; content: Buffer }> = []
    for (const filePath of buildFiles) {
      const content = await sandbox.fs.downloadFile(`/workspace/${filePath}`)
      const relativePath = filePath.replace('dist/', '')
      filesToUpload.push({
        path: relativePath,
        content: content
      })
    }

    return filesToUpload
  }

  /**
   * Get dev server port
   */
  getDevPort(): number {
    return 5173
  }

  /**
   * Get build directory
   */
  getBuildDir(): string {
    return 'dist'
  }
}

