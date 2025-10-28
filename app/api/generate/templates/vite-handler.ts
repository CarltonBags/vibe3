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
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['tailwind.config.js']), 
      '/workspace/tailwind.config.js'
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
      Buffer.from(templateFiles['tsconfig.node.json']), 
      '/workspace/tsconfig.node.json'
    )
    
    await sandbox.fs.uploadFile(
      Buffer.from(templateFiles['index.html']), 
      '/workspace/index.html'
    )

    // Create project structure
    await sandbox.fs.createFolder('/workspace/src', '755')
    await sandbox.fs.createFolder('/workspace/src/components', '755')
    await sandbox.fs.createFolder('/workspace/src/types', '755')
    await sandbox.fs.createFolder('/workspace/src/utils', '755')

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

