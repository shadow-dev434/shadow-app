import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/export?format=csv|json
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';

    const tasks = await db.task.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const reviews = await db.review.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 90,
    });

    const patterns = await db.userPattern.findFirst({ where: { userId } });

    if (format === 'csv') {
      const headers = [
        'id', 'title', 'description', 'importance', 'urgency', 'resistance', 'size',
        'category', 'context', 'quadrant', 'decision', 'status', 'priorityScore',
        'avoidanceCount', 'deadline', 'completedAt', 'createdAt',
      ];

      const escapeCSV = (val: string | null | undefined | number) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvRows = [
        headers.join(','),
        ...tasks.map((t) =>
          headers.map((h) => escapeCSV((t as Record<string, unknown>)[h] as string | number | null)).join(',')
        ),
      ].join('\n');

      return new NextResponse(csvRows, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="shadow-tasks-export.csv"',
        },
      });
    }

    // JSON format
    return NextResponse.json({
      exportDate: new Date().toISOString(),
      tasks,
      reviews,
      patterns,
    }, {
      headers: {
        'Content-Disposition': 'attachment; filename="shadow-data-export.json"',
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Errore nell\'esportazione dati' }, { status: 500 });
  }
}
