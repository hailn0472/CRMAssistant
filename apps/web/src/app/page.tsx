import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function Home(): React.JSX.Element {
  return (
    <main className="min-h-screen p-8 bg-background">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">CRMAssistant</h1>
          <p className="text-muted-foreground mt-2">
            AI-powered CRM platform cho sales teams
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>shadcn/ui Components Demo</CardTitle>
            <CardDescription>
              Frontend foundation đã được thiết lập thành công với Next.js 14, Tailwind CSS, và shadcn/ui
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="email">
                Email
              </label>
              <Input id="email" placeholder="Nhập email..." type="email" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>Primary Button</Button>
              <Button variant="outline">Outline Button</Button>
              <Button variant="secondary">Secondary Button</Button>
              <Button variant="destructive">Destructive Button</Button>
              <Button variant="ghost">Ghost Button</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tech Stack</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>Next.js 14.2.x (App Router)</li>
              <li>TypeScript 5.0+ (Strict Mode)</li>
              <li>Tailwind CSS 3.4+</li>
              <li>shadcn/ui components</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
