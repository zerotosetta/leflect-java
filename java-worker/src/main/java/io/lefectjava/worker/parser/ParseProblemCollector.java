package io.lefectjava.worker.parser;

import com.github.javaparser.ParseResult;
import com.github.javaparser.Problem;
import io.lefectjava.worker.model.ParseProblemRecord;

import java.util.ArrayList;
import java.util.List;

public class ParseProblemCollector {
  public List<ParseProblemRecord> collect(String sourcePath, ParseResult<?> result) {
    List<ParseProblemRecord> records = new ArrayList<>();
    for (Problem problem : result.getProblems()) {
      records.add(new ParseProblemRecord(sourcePath, problem.getVerboseMessage()));
    }
    return records;
  }
}
