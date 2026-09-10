import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ImportDropZone } from '../ImportDropZone'

describe('ImportDropZone', () => {
  const onFileSelected = jest.fn()
  const onDownloadTemplate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders drag-and-drop zone with instructions', () => {
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )
    expect(screen.getByText(/drag and drop a csv file/i)).toBeInTheDocument()
  })

  it('renders fallback browse files button', () => {
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )
    expect(screen.getByText(/browse files/i)).toBeInTheDocument()
  })

  it('has file input with accept .csv and .tsv', () => {
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )
    const input = screen.getByTestId('file-input')
    expect(input).toHaveAttribute('accept', '.csv,.tsv')
  })

  it('renders template download button', () => {
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )
    expect(screen.getByText('Download template CSV')).toBeInTheDocument()
  })

  it('calls onDownloadTemplate when template button clicked', async () => {
    const user = userEvent.setup()
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )
    await user.click(screen.getByText('Download template CSV'))
    expect(onDownloadTemplate).toHaveBeenCalledTimes(1)
  })

  it('calls onFileSelected with a valid CSV file', async () => {
    const user = userEvent.setup()
    render(
      <ImportDropZone onDownloadTemplate={onDownloadTemplate} onFileSelected={onFileSelected} />,
    )

    const file = new File(['email,name\ntest@test.com,Test'], 'test.csv', { type: 'text/csv' })
    const input = screen.getByTestId('file-input')
    await user.upload(input, file)

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })
})
