package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.lefectjava.worker.io.JsonWriters;
import io.lefectjava.worker.parser.SourceSyntaxExtractor;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Reads immutable source text over a private UTF-8 JSON-lines pipe. */
final class SourceSyntaxCommand {
  int run() {
    var extractor = new SourceSyntaxExtractor();
    var mapper = new ObjectMapper();
    try (var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
         var output = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8))) {
      String line;
      while ((line = input.readLine()) != null) {
        JsonNode request = mapper.readTree(line);
        int id = request.path("id").asInt();
        Map<String, Object> response;
        try {
          if (request.hasNonNull("platformMemberTypes")) {
            JsonNode query = request.get("platformMemberTypes");
            var members = extractor.platformMemberTypes(query.path("owner").asText(), query.path("member").asText());
            response = members == null ? Map.of("id", id) : Map.of("id", id, "platformMemberTypes", members);
          } else if (request.hasNonNull("platformTypeAccess")) {
            response = Map.of("id", id, "platformTypeAccess", extractor.platformTypeAccess(request.get("platformTypeAccess").asText()));
          } else if (request.hasNonNull("platformType")) {
            response = Map.of("id", id, "platformType", extractor.isPlatformType(request.get("platformType").asText()));
          } else {
            response = Map.of("id", id, "syntax", extractor.extract(request.path("source").asText()));
          }
        } catch (RuntimeException exception) {
          response = Map.of("id", id, "error", "JavaParser could not inspect the supplied source");
        }
        JsonWriters.appendJsonLine(output, response);
        output.flush();
      }
      return 0;
    } catch (IOException exception) {
      System.err.println("Source syntax pipe failed: " + exception.getMessage());
      return 1;
    }
  }
}
