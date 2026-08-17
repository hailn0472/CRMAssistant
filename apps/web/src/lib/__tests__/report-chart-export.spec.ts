import {
  downloadBlob,
  exportChartAsPng,
  exportChartAsSvg,
  prepareSvgForExport,
  sanitizeExportFilename,
} from '../report-chart-export'

describe('report-chart-export (Contract D, AC 12, 14, 16)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let createObjectURLMock: jest.Mock
  let revokeObjectURLMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL

    createObjectURLMock = jest.fn().mockReturnValue('blob:http://localhost/fake-blob-uuid')
    revokeObjectURLMock = jest.fn()

    URL.createObjectURL = createObjectURLMock
    URL.revokeObjectURL = revokeObjectURLMock
  })

  afterEach(() => {
    jest.useRealTimers()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('sanitizeExportFilename', () => {
    it('generates a clean sanitized filename with extension', () => {
      expect(sanitizeExportFilename('Monthly Revenue / Deals: 2026', 'LINE', 'svg')).toBe(
        'monthly-revenue-deals-2026-line.svg',
      )
      expect(sanitizeExportFilename(null, 'BAR', 'png')).toBe('report-chart-bar.png')
      expect(sanitizeExportFilename('   ', 'PIE', 'svg')).toBe('report-chart-pie.svg')
    })
  })

  describe('prepareSvgForExport', () => {
    it('clones SVG element, sets dimensions, opaque background and UTF-8 XMLNS headers', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '500')
      svg.setAttribute('height', '300')
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.textContent = 'Revenue'
      svg.appendChild(text)

      const preparedString = prepareSvgForExport({
        svgElement: svg,
        title: 'Monthly Revenue',
        backgroundColor: '#ffffff',
      })

      expect(preparedString).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(preparedString).toContain('<rect width="100%" height="100%" fill="#ffffff"')
      expect(preparedString).toContain('Monthly Revenue')
    })
  })

  describe('downloadBlob and revocation (Contract G.39)', () => {
    it('creates object URL, triggers download and revokes URL after timeout', () => {
      const appendSpy = jest.spyOn(document.body, 'appendChild')
      const removeSpy = jest.spyOn(document.body, 'removeChild')
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      const blob = new Blob(['<svg></svg>'], { type: 'image/svg+xml' })
      downloadBlob(blob, 'chart.svg')

      expect(createObjectURLMock).toHaveBeenCalledWith(blob)
      expect(appendSpy).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(removeSpy).toHaveBeenCalled()

      expect(revokeObjectURLMock).not.toHaveBeenCalled()
      jest.advanceTimersByTime(1000)
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-blob-uuid')

      appendSpy.mockRestore()
      removeSpy.mockRestore()
      clickSpy.mockRestore()
    })
  })

  describe('exportChartAsSvg', () => {
    it('handles null svg element safely', () => {
      expect(() => exportChartAsSvg(null, 'Test', 'LINE')).not.toThrow()
    })

    it('exports svg element and downloads blob', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      expect(() => exportChartAsSvg(svg, 'Test Chart', 'LINE')).not.toThrow()
      expect(createObjectURLMock).toHaveBeenCalled()
    })
  })

  describe('exportChartAsPng error paths (Contract G.39)', () => {
    it('resolves immediately when svg element is null', async () => {
      await expect(exportChartAsPng(null, 'Test', 'BAR')).resolves.toBeUndefined()
    })

    it('handles image error gracefully and revokes URL', async () => {
      let createdImage: any = null
      const OriginalImage = global.Image
      // @ts-expect-error mock image
      global.Image = class {
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          createdImage = this
        }
      }

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const promise = exportChartAsPng(svg, 'Test', 'BAR')

      // Trigger onerror
      expect(createdImage).not.toBeNull()
      createdImage.onerror()

      await expect(promise).resolves.toBeUndefined()
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-blob-uuid')

      global.Image = OriginalImage
    })

    it('handles null canvas 2D context gracefully and revokes URL', async () => {
      let createdImage: any = null
      const OriginalImage = global.Image
      // @ts-expect-error mock image
      global.Image = class {
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          createdImage = this
        }
      }

      const getContextSpy = jest
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(null)

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const promise = exportChartAsPng(svg, 'Test', 'BAR')

      expect(createdImage).not.toBeNull()
      createdImage.onload()

      await expect(promise).resolves.toBeUndefined()
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-blob-uuid')

      getContextSpy.mockRestore()
      global.Image = OriginalImage
    })

    it('handles null png blob from canvas gracefully and revokes URL', async () => {
      let createdImage: any = null
      const OriginalImage = global.Image
      // @ts-expect-error mock image
      global.Image = class {
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          createdImage = this
        }
      }

      const toBlobSpy = jest
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((cb: (blob: Blob | null) => void) => {
          cb(null)
        })

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const promise = exportChartAsPng(svg, 'Test', 'BAR')

      expect(createdImage).not.toBeNull()
      createdImage.onload()

      await expect(promise).resolves.toBeUndefined()
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-blob-uuid')

      toBlobSpy.mockRestore()
      global.Image = OriginalImage
    })
  })
})
