import { useState } from 'react'
import { Download, FileArchive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

export default function Diagnostics() {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    toast.loading('Exporting diagnostics...', { id: 'diagnostics-export' })

    try {
      const result = await window.api.exportDiagnostics()

      if (result.cancelled) {
        toast.dismiss('diagnostics-export')
      } else if (result.success) {
        toast.success('Diagnostics exported', {
          id: 'diagnostics-export',
          description: result.filePath
        })
      } else {
        toast.error('Export failed', {
          id: 'diagnostics-export',
          description: result.error || 'Unknown error'
        })
      }
    } catch (error) {
      toast.error('Export failed', {
        id: 'diagnostics-export',
        description: error.message
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="p-4 max-w-4xl">
      <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
              <FileArchive className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="mb-1 font-medium">Export Logs</h4>
              <p className="text-sm text-gray-500">
                Export application logs and system info for troubleshooting
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0 w-40"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download size={16} className="mr-2" />
                  Export
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
