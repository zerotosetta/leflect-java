package io.lefectjava.worker.parser;

import com.github.javaparser.ast.Node;
import com.github.javaparser.serialization.JavaParserJsonSerializer;
import jakarta.json.Json;
import jakarta.json.stream.JsonGenerator;
import jakarta.json.stream.JsonGeneratorFactory;

import java.io.StringWriter;
import java.util.Map;

public class JavaParserAstSerializer {
  private final JavaParserJsonSerializer serializer;
  private final JsonGeneratorFactory generatorFactory;

  public JavaParserAstSerializer() {
    this(
        new JavaParserJsonSerializer(),
        Json.createGeneratorFactory(Map.of(JsonGenerator.PRETTY_PRINTING, true))
    );
  }

  public JavaParserAstSerializer(
      JavaParserJsonSerializer serializer,
      JsonGeneratorFactory generatorFactory
  ) {
    this.serializer = serializer;
    this.generatorFactory = generatorFactory;
  }

  public String serialize(Node node) {
    StringWriter writer = new StringWriter();
    JsonGenerator generator = generatorFactory.createGenerator(writer);
    serializer.serialize(node, generator);
    return writer.toString();
  }
}
