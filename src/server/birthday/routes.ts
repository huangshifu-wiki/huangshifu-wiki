import { Router, Request, Response } from 'express'
import { requireAdmin, requireActiveUser } from '../middleware/auth'
import type { AuthenticatedRequest } from '../types'
import * as birthdayService from './birthdayService'

const router = Router()

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const configs = await birthdayService.getAllBirthdayConfigs()
    res.json({ data: configs })
  } catch (error) {
    console.error('Error fetching birthday configs:', error)
    res.status(500).json({ error: 'Failed to fetch configs' })
  }
})

router.get('/config/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params
    const configs = await birthdayService.getBirthdayConfigsByType(type)
    res.json({ data: configs })
  } catch (error) {
    console.error('Error fetching birthday config by type:', error)
    res.status(500).json({ error: 'Failed to fetch config' })
  }
})

router.post('/config', requireAdmin, requireActiveUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, title, content, sortOrder, isActive } = req.body
    if (!type || !title || !content) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }
    const config = await birthdayService.createBirthdayConfig({ type, title, content, sortOrder, isActive })
    res.status(201).json({ data: config })
  } catch (error) {
    console.error('Error creating birthday config:', error)
    res.status(500).json({ error: 'Failed to create config' })
  }
})

router.put('/config/:id', requireAdmin, requireActiveUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const { title, content, sortOrder, isActive } = req.body
    const config = await birthdayService.updateBirthdayConfig(id, { title, content, sortOrder, isActive })
    res.json({ data: config })
  } catch (error) {
    console.error('Error updating birthday config:', error)
    res.status(500).json({ error: 'Failed to update config' })
  }
})

router.patch('/config/:id/toggle', requireAdmin, requireActiveUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const config = await birthdayService.toggleBirthdayConfigActive(id)
    res.json({ data: config })
  } catch (error) {
    console.error('Error toggling birthday config:', error)
    res.status(500).json({ error: 'Failed to toggle config' })
  }
})

router.delete('/config/:id', requireAdmin, requireActiveUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    await birthdayService.deleteBirthdayConfig(id)
    res.status(204).send()
  } catch (error) {
    console.error('Error deleting birthday config:', error)
    res.status(500).json({ error: 'Failed to delete config' })
  }
})

export function registerBirthdayRoutes(app: Router) {
  app.use('/api/birthday', router)
}

export default router
