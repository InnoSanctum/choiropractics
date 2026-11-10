import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface XmlNode { tag: string; attrs: Record<string, string>; text: string; children: XmlNode[] }
export const children = (node: XmlNode, tag: string) => node.children.filter(n => n.tag === tag);
export const child = (node: XmlNode, tag: string) => node.children.find(n => n.tag === tag);
export const value = (node: XmlNode, tag: string, fallback = '') => child(node, tag)?.text ?? fallback;
export function descendants(node: XmlNode, tag: string): XmlNode[] {
  return node.children.flatMap(n => [...(n.tag === tag ? [n] : []), ...descendants(n, tag)]);
}
export function parseXml(xml: string): XmlNode {
  if (xml.length > 16_000_000) throw new Error('The score XML is too large (maximum 16 MB).');
  // MuseScore 2/3 use this harmless declaration. Custom DTDs/entities are never needed.
  xml = xml.replace(/<!DOCTYPE\s+museScore\s*>/i, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Custom XML entities are not supported. Save the score again in MuseScore.');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Invalid score XML: ${validation.err.msg}`);
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, trimValues: true });
  type Ordered = Record<string, unknown>;
  const convert = (list: Ordered[]): XmlNode[] => list.flatMap(item => {
    const tag = Object.keys(item).find(k => k !== ':@' && !k.startsWith('#') && !k.startsWith('?'));
    if (!tag) return [];
    const entries = item[tag] as Ordered[];
    const nodes = convert(entries);
    const text = entries.map(e => e['#text'] ?? '').join('') + nodes.map(n => n.text).join('');
    return [{ tag, attrs: (item[':@'] ?? {}) as Record<string, string>, text, children: nodes }];
  });
  const nodes = convert(parser.parse(xml));
  if (nodes.length !== 1) throw new Error('Expected one score XML document.');
  return nodes[0];
}
