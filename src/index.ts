import assert from 'assert'
import {
  NotionAgent,
  RecordValue,
  RecordRequest,
  BlockNode
} from './types/interfaces'

export = async function downloadPageAsTree(pageID: string, agent: NotionAgent): Promise<BlockNode> {

  assert(typeof pageID === 'string')

  assert(typeof agent === 'object')
  assert(typeof agent.getRecordValues === 'function')

  const api = agent

  /**
   * Only downloading children of a root "page" block.
   * This prevents downloading children of "link to a page" and
   * "embeded sub-page" blocks.
   */
  let pageRootDownloaded = false

  /* Get all records in a flat array. */
  const allRecords = await getChildrenRecords([pageID])

  return makeTree(allRecords)
  //return { records: allRecords }

  /**
   * Get RecordValues of some IDs and their descendants.
   * @param ids - Some IDs.
   * @returns RecordValues of those IDs and their descendants.
   */
  async function getChildrenRecords(ids: string[]): Promise<RecordValue[]> {

    let requests = makeRecordRequests(ids)
    let response = await api.getRecordValues(requests)
    let responseData = response.data
    let childrenRecords: RecordValue[]
    let childrenIDs: string[]

    /** 
     * Currently, I ignore any "page" block except the root page.
     * 
     * More information:
     * 
     * Notion marks a "link to page" block as "page", which has two problems :
     * 1. The "page" block points to its children, require additional checking
     * when doing recursive download.
     * 2. The "parent_id" of the "page" block does not points to the root page
     * we want to download. This way we can't construct a tree correctly.
     */
    if (pageRootDownloaded) {
      /* Filter out "page" blocks. */
      childrenRecords = responseData.results.filter((record: RecordValue): boolean => {
        return record.role !== 'none' && record.value.type !== 'page'
      })
      childrenIDs = collectChildrenIDs(childrenRecords)
    } else {
      childrenRecords = responseData.results
      childrenIDs = collectChildrenIDs(childrenRecords)
      pageRootDownloaded = true
    }

    /* If there're remaining children, download them. */
    if (childrenIDs.length > 0) {
      return childrenRecords.concat(await getChildrenRecords(childrenIDs))
    } else {
      return childrenRecords
    }

  }

}

/**
 * Make payload for getRecordValues API.
 * @param ids - Notion record ID array.
 * @returns A payload.
 */
function makeRecordRequests(ids: string[]): RecordRequest[] {

  let requests = ids.map((id): RecordRequest => {
    return { id, table: 'block' }
  })

  return requests

}

/**
 * Collect children IDs of an records array.
 * @param records - The records array.
 * @returns An array of IDs.
 */
function collectChildrenIDs(records: RecordValue[]): string[] {

  let childrenIDs: string[] = []

  records.forEach((record): void => {
    let _childrenIDs = [] as string[]

    if (record.value != null && record.value.content != null) {
      _childrenIDs = record.value.content
    }

    if (_childrenIDs) {
      childrenIDs = childrenIDs.concat(_childrenIDs)
    }

  })

  return childrenIDs

}

/**
 * Convert RecordValue array to a Notion abstract syntax tree.
 * The tree must have single root and it is the first item in the array.
 * @param allRecords - The RecordValue array.
 * @returns A Notion abstract syntax tree.
 */
function makeTree(allRecords: RecordValue[]): BlockNode {

  /* Cast RecordValue to BlockNode. */
  let list = allRecords.map((record): BlockNode => {
    return {
      type: record.value.type,
      data: record.value.properties,
      raw_value: record.value,
      children: [] as BlockNode[]
    }
  })

  /* A map for quick ID -> index lookup. */
  let map: { [key: string]: number } = {}
  for (let i = 0; i < allRecords.length; ++i) {
    map[list[i].raw_value.id] = i
  }

  /* The tree's root is always the first of RecordValue array. */
  let treeRoot = list[0]
  let node

  /**
   * Wire up each block's children by iterating through its content
   * and find each child's reference by ID.
   */
  for (let i = 0; i < allRecords.length; ++i) {
    node = list[i]
    /**
     * It's sad that parent_id of some blocks are incorrect, so the following
     * faster way doesn't work.
     */
    // list[map[node.raw_value.parent_id]].children.push(node)

    /** The slower way. */
    let childrenIDs = node.raw_value.content
    if (childrenIDs != null) {
      for (let j = 0; j < childrenIDs.length; ++j) {
        let indexOfChildReference = map[childrenIDs[j]]
        let childReference = list[indexOfChildReference]
        node.children.push(childReference)
      }
    }
  }

  return treeRoot

}