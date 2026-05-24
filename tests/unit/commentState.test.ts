import { describe, expect, it } from 'vitest'
import { markCommentDeleted } from '../../src/utils/commentState'

describe('commentState', () => {
  it('removes a deleted root placeholder after its last visible child is deleted', () => {
    const comments = [
      {
        id: 'root',
        parentId: null,
        content: '评论已删除',
        isDeleted: true,
      },
      {
        id: 'child',
        parentId: 'root',
        content: 'visible child',
        isDeleted: false,
      },
    ]

    const nextComments = markCommentDeleted(comments, {
      commentId: 'child',
      deletedContent: '评论已删除',
      deletedBy: 'user-1',
      deletedByName: 'User 1',
      showDeletedComments: false,
    })

    expect(nextComments).toEqual([])
  })

  it('keeps deleted comments when deleted comments are shown', () => {
    const comments = [
      {
        id: 'root',
        parentId: null,
        content: 'deleted root content',
        isDeleted: true,
      },
      {
        id: 'child',
        parentId: 'root',
        content: 'visible child',
        isDeleted: false,
      },
    ]

    const nextComments = markCommentDeleted(comments, {
      commentId: 'child',
      deletedContent: '评论已删除',
      deletedBy: 'user-1',
      deletedByName: 'User 1',
      showDeletedComments: true,
    })

    expect(nextComments).toHaveLength(2)
    expect(nextComments[1]).toMatchObject({
      id: 'child',
      content: 'visible child',
      isDeleted: true,
      deletedBy: 'user-1',
      deletedByName: 'User 1',
    })
  })
})
