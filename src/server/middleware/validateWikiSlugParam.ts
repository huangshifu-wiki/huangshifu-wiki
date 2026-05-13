import { Request, Response, NextFunction } from 'express';

const SLUG_PATTERN = /^[\w\u4e00-\u9fff/-]+$/;

export function validateWikiSlugParam(req: Request, res: Response, next: NextFunction): void {
  const slug = req.params.slug;
  if (!slug || typeof slug !== 'string' || slug.length > 200 || /\0|\\|\.\./.test(slug) || !SLUG_PATTERN.test(slug)) {
    res.status(400).json({ error: 'Invalid slug parameter' });
    return;
  }
  next();
}
