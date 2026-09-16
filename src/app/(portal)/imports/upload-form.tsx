import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A plain multipart form to the /api/imports route: the browser streams the file, the route
 * runs the pipeline and redirects to the new load's page. No JavaScript is needed to upload.
 */
export function UploadForm({ error }: { error?: string }) {
  return (
    <form
      action="/api/imports"
      method="post"
      encType="multipart/form-data"
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="import-kind">What the file contains</Label>
        <select
          id="import-kind"
          name="kind"
          required
          defaultValue="contacts"
          className="h-9 rounded-sm border border-rule bg-background px-3 text-sm"
        >
          <option value="contacts">Contacts</option>
          <option value="campaigns">Campaigns</option>
          <option value="events">Engagement events</option>
          <option value="send_log">Send log</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <Button type="submit" variant="outline">
        Import
      </Button>
      {error ? (
        <p role="alert" className="border-l-2 border-bad pl-3 text-sm text-bad sm:ml-2">
          {error}
        </p>
      ) : null}
    </form>
  );
}
