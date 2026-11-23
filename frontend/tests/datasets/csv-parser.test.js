import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from '../../src/features/datasets/csv-parser'

describe('csv-parser', () => {
  describe('detectDelimiter', () => {
    it('detects comma delimiter', () => {
      expect(detectDelimiter('id,name,value\n1,foo,bar')).toBe(',')
    })

    it('detects tab delimiter', () => {
      expect(detectDelimiter('id\tname\tvalue\n1\tfoo\tbar')).toBe('\t')
    })

    it('detects semicolon delimiter', () => {
      expect(detectDelimiter('id;name;value\n1;foo;bar')).toBe(';')
    })

    it('defaults to comma on empty or plain text', () => {
      expect(detectDelimiter('')).toBe(',')
      expect(detectDelimiter('singleword')).toBe(',')
    })
  })

  describe('parseCsv', () => {
    it('returns error when text is empty or blank', () => {
      const res = parseCsv('')
      expect(res.error).toContain('empty')
      expect(res.rows).toHaveLength(0)

      const blankRes = parseCsv('   \n  \n')
      expect(blankRes.error).toContain('empty')
    })

    it('parses standard comma-separated text with headers and rows', () => {
      const input = 'task_id,function_name,difficulty\nP01,square,easy\nP02,cube,medium'
      const res = parseCsv(input)
      expect(res.error).toBeNull()
      expect(res.headers).toEqual(['task_id', 'function_name', 'difficulty'])
      expect(res.rows).toEqual([
        ['P01', 'square', 'easy'],
        ['P02', 'cube', 'medium'],
      ])
      expect(res.rowCount).toBe(2)
    })

    it('handles quoted fields with commas and escaped quotes', () => {
      const input = 'id,code\n1,"def foo(x):\n    return x + 1"\n2,"print(""hello, world"")"'
      const res = parseCsv(input)
      expect(res.error).toBeNull()
      expect(res.headers).toEqual(['id', 'code'])
      expect(res.rows[0][1]).toBe('def foo(x):\n    return x + 1')
      expect(res.rows[1][1]).toBe('print("hello, world")')
    })

    it('strips UTF-8 BOM if present', () => {
      const input = '\uFEFFtask_id,func\nP01,solve'
      const res = parseCsv(input)
      expect(res.headers[0]).toBe('task_id')
      expect(res.rows[0]).toEqual(['P01', 'solve'])
    })

    it('normalizes CRLF and LF newlines and ignores trailing blank rows', () => {
      const input = "a,b\r\n1,2\r\n3,4\r\n\r\n"
      const res = parseCsv(input)
      expect(res.rowCount).toBe(2)
      expect(res.rows).toEqual([['1', '2'], ['3', '4']])
    })

    it('returns error when CSV has headers but no data rows', () => {
      const input = 'task_id,function_name'
      const res = parseCsv(input)
      expect(res.error).toContain('no data rows')
      expect(res.headers).toEqual(['task_id', 'function_name'])
      expect(res.rows).toHaveLength(0)
    })

    it('renames duplicate headers to avoid collision', () => {
      const input = 'name,Name,value\na,b,c'
      const res = parseCsv(input)
      expect(res.headers[0].toLowerCase()).toBe('name')
      expect(res.headers[1].toLowerCase()).toBe('name_2')
      expect(res.warnings.length).toBeGreaterThan(0)
    })

    it('pads rows if row length is less than header length', () => {
      const input = 'a,b,c\n1,2\n3,4,5'
      const res = parseCsv(input)
      expect(res.rows[0]).toEqual(['1', '2', ''])
      expect(res.rows[1]).toEqual(['3', '4', '5'])
    })
  })
})
