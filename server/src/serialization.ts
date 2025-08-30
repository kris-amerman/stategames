// server/src/serialization.ts

/**
 * JSON serialization layer with TypedArray support
 * 
 * This module provides encode/decode functions that handle TypedArrays
 * by converting them to regular arrays for JSON serialization, then
 * reconstructing them during deserialization.
 * 
 * Design considerations:
 * - Keeps serialization decoupled from game logic
 * - Preserves all TypedArray types (Float64Array, Uint8Array, etc.)
 * - Can be easily replaced with protobuf/cap'n proto later
 * - Uses clear metadata to identify TypedArrays during reconstruction
 */

interface TypedArrayDescriptor {
  __typedArray: true;
  type: string;
  data: number[];
}

/**
 * Supported TypedArray types for serialization
 */
const TYPED_ARRAY_CONSTRUCTORS: Record<string, new (data: number[]) => any> = {
  'Float64Array': Float64Array,
  'Uint8Array': Uint8Array,
  'Uint32Array': Uint32Array,
  'Int32Array': Int32Array,
  'Float32Array': Float32Array,
  'Uint16Array': Uint16Array,
  'Int16Array': Int16Array,
};

/**
 * Recursively converts TypedArrays to serializable descriptors
 */
function serializeTypedArrays(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle TypedArrays
  if (ArrayBuffer.isView(obj) && obj.constructor.name in TYPED_ARRAY_CONSTRUCTORS) {
    const descriptor: TypedArrayDescriptor = {
      __typedArray: true,
      type: obj.constructor.name,
      data: Array.from(obj as any)
    };
    return descriptor;
  }

  // Handle regular arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeTypedArrays(item));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeTypedArrays(value);
    }
    return result;
  }

  // Primitive values pass through unchanged
  return obj;
}

/**
 * Recursively reconstructs TypedArrays from descriptors
 */
function deserializeTypedArrays(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle TypedArray descriptors
  if (typeof obj === 'object' && obj.__typedArray === true) {
    const descriptor = obj as TypedArrayDescriptor;
    const Constructor = TYPED_ARRAY_CONSTRUCTORS[descriptor.type];
    if (!Constructor) {
      throw new Error(`Unknown TypedArray type: ${descriptor.type}`);
    }
    return new Constructor(descriptor.data);
  }

  // Handle regular arrays
  if (Array.isArray(obj)) {
    return obj.map(item => deserializeTypedArrays(item));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deserializeTypedArrays(value);
    }
    return result;
  }

  // Primitive values pass through unchanged
  return obj;
}

/**
 * Encodes any object to JSON string with TypedArray support
 */
export function encode(obj: any): string {
  try {
    const serializable = serializeTypedArrays(obj);
    return JSON.stringify(serializable);
  } catch (error) {
    throw new Error(`Failed to encode object: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decodes JSON string back to object with TypedArrays reconstructed
 */
export function decode<T = any>(data: string): T {
  try {
    const parsed = JSON.parse(data);
    return deserializeTypedArrays(parsed) as T;
  } catch (error) {
    throw new Error(`Failed to decode JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}