import ts from "typescript";
import { Parser } from "xml2js";
import { readFileSync, writeFileSync } from "fs";

const sourceFile = ts.createSourceFile(
  "soap-types.ts", // the output file name
  "", // the text of the source code, not needed for our purposes
  ts.ScriptTarget.Latest, // the target language version for the output file
  false,
  ts.ScriptKind.TS // output script kind. options include JS, TS, JSX, TSX and others
);

// Primitive datatypes defined by SOAP (there are more)
type SoapPrimitive =
  | "xsd:boolean"
  | "xsd:double"
  | "xsd:float"
  | "xsd:int"
  | "xsd:short"
  | "xsd:signedInt"
  | "xsd:string"
  | "xsd:unsignedInt"
  | "xsd:unsignedShort"
  | "xsd:dateTime";

// SOAP message type
interface IMessage {
  meta: {
    name: string;
  };
  part: {
    meta: {
      name: string;
      type: SoapPrimitive;
      minOccurs?: string; // default = 1, making the field required. 0 notes an optional field
    };
  }[];
}

interface IOperation {
  meta: {
    name: string;
  };
  input: {
    meta: {
      name: string;
    };
  };
  output: {
    meta: {
      name: string;
    };
  };
}

// Top-level WSDL object structure
interface IServiceDefinition {
  definitions: {
    message: IMessage[];
    portType: {
      operation: IOperation[];
    }[];
  };
}

async function readWSDL(filePath: string): Promise<IServiceDefinition> {
  const wsdlData = readFileSync(filePath, { encoding: "utf-8" });

  const xmlParser = new Parser({
    attrkey: "meta", // instructs the parser to pack XML node attributes into a sub-object titled "meta"
  });

  const serviceDefinition = await xmlParser.parseStringPromise(wsdlData);
  console.log(JSON.stringify(serviceDefinition, null, 2));

  // I would recommend a more explicit conversion, but for the sake of brevity, this example just casts the object to the interface type.
  return serviceDefinition as IServiceDefinition;
}

const dataTypes: Record<SoapPrimitive, string> = {
  "xsd:boolean": "Boolean",
  "xsd:double": "Number",
  "xsd:float": "Number",
  "xsd:int": "Number",
  "xsd:string": "String",
  "xsd:short": "Number",
  "xsd:signedInt": "Number",
  "xsd:unsignedInt": "Number",
  "xsd:dateTime": "Date",
  "xsd:unsignedShort": "Number",
};

// Convert from SOAP primitive type to a Typescript type reference, defaulting to String
function typeFromSOAP(soapType: SoapPrimitive): ts.TypeReferenceNode {
  const typeName = dataTypes[soapType] ?? "String";
  return ts.factory.createTypeReferenceNode(typeName, []);
}

// used for marking attributes as optional
const optionalFieldMarker = ts.factory.createToken(ts.SyntaxKind.QuestionToken);

// used for adding `export` directive to generated type
const exportModifier = ts.factory.createModifiersFromModifierFlags(
  ts.ModifierFlags.Export
);

function generateMessageInterface(message: IMessage): ts.InterfaceDeclaration {
  // name of the interface
  const interfaceSymbol = ts.factory.createIdentifier(message.meta.name);

  const interfaceMembers = message.part.map((part) => {
    const propertySymbol = ts.factory.createIdentifier(part.meta.name);

    // WSDL treats fields with no minOccurs as required, and fields with minOccurs > 0 as required
    const required =
      !Boolean(part.meta.minOccurs) || Number(part.meta.minOccurs) > 0;

    // representation of the interface property syntax
    const member = ts.factory.createPropertySignature(
      undefined, // modifiers (not allowed for interfaces)
      propertySymbol, // name of the property
      required ? undefined : optionalFieldMarker,
      typeFromSOAP(part.meta.type) // data type
    );
    return member;
  });

  const cl = ts.factory.createInterfaceDeclaration(
    undefined, // no decorators
    exportModifier, // modifiers
    interfaceSymbol, // interface name
    undefined, // no generic type parameters
    undefined, // no heritage clauses (extends, implements)
    interfaceMembers // interface attributes
  );

  return cl;
}

// used for adding `async` and `export` modifier to generated function
const asyncExportModifier = ts.factory.createModifiersFromModifierFlags(
  ts.ModifierFlags.Export | ts.ModifierFlags.Async
);

function generateOperationFunction(
  methodName: string,
  inputType: ts.InterfaceDeclaration,
  outputType: ts.InterfaceDeclaration
): ts.FunctionDeclaration {
  const functionIdentifier = ts.factory.createIdentifier(methodName);

  const inputTypeNode = ts.factory.createTypeReferenceNode(inputType.name);
  const outputTypeNode = ts.factory.createTypeReferenceNode(outputType.name);
  const outputTypePromiseNode = ts.factory.createTypeReferenceNode("Promise", [
    outputTypeNode,
  ]);

  const inputParameter = ts.factory.createParameterDeclaration(
    undefined, // decorators,
    undefined, // modifiers,
    undefined, // spread operator
    "input", // name
    undefined, // optional marker,
    inputTypeNode, // type
    undefined // initializer
  );

  const fn = ts.factory.createFunctionDeclaration(
    undefined, // decorators
    asyncExportModifier,
    undefined, // asterisk token
    functionIdentifier,
    undefined, // generic type parameters
    [inputParameter], // arguments
    outputTypePromiseNode, // return type
    undefined // function body
  );

  return fn;
}

async function main() {
  // read service definition into object
  const serviceDefinition = await readWSDL("quote_service.wsdl");
  console.log(serviceDefinition.definitions.portType[0].operation);

  // create interface definitions
  const messageInterfaces = serviceDefinition.definitions.message.map(
    generateMessageInterface
  );

  const operationFunctions =
    serviceDefinition.definitions.portType[0].operation.map((op) =>
      generateOperationFunction(
        op.meta.name,
        messageInterfaces[0],
        messageInterfaces[1]
      )
    );

  const nodes: ts.Node[] = [...messageInterfaces, ...operationFunctions];

  const nodeArr = ts.factory.createNodeArray(nodes);

  // printer for writing the AST to a file as code
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const result = printer.printList(
    ts.ListFormat.MultiLine,
    nodeArr,
    sourceFile
  );

  // write the code to file
  writeFileSync("soap-types.ts", result, { encoding: "utf-8" });
}

main();
