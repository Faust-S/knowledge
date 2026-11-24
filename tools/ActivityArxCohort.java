// Local adapter to the original ARX 3.9.2 library, not an anonymization algorithm.
// Only the Python worker supplies this bounded, tokenized stdin protocol.
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.deidentifier.arx.*;
import org.deidentifier.arx.AttributeType.Hierarchy;
import org.deidentifier.arx.criteria.KAnonymity;
import org.deidentifier.arx.metric.Metric;
import org.deidentifier.arx.risk.RiskModelSampleRisks;

class ActivityArxCohort {
    static void require(boolean ok) { if (!ok) throw new IllegalArgumentException(); }
    static String[] read(BufferedReader in, int width) throws IOException {
        String line = in.readLine();
        require(line != null && line.length() <= 32768);
        String[] row = line.split("\t", -1);
        require(row.length == width);
        return row;
    }
    static double risk(DataHandle handle) {
        RiskModelSampleRisks result = handle.getRiskEstimator().getSampleBasedReidentificationRisk();
        double value = result.getHighestRisk();
        require(Double.isFinite(value) && value > 0 && value <= 1);
        return value;
    }
    public static void main(String[] args) {
        try {
            require(args.length == 0 && "3.9.2".equals(ARXAnonymizer.VERSION));
            BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            String[] cfg = read(in, 3);
            int n = Integer.parseInt(cfg[0]), m = Integer.parseInt(cfg[1]), k = Integer.parseInt(cfg[2]);
            require(n >= 2 && n <= 5000 && m >= 1 && m <= 8 && k >= 2 && k <= 100 && n >= k);
            String[] names = new String[m];
            for (int j = 0; j < m; j++) names[j] = "q" + j;
            Data.DefaultData data = Data.create();
            data.add(names);
            for (int i = 0; i < n; i++) data.add(read(in, m));
            for (int j = 0; j < m; j++) {
                String[] spec = read(in, 3);
                int rows = Integer.parseInt(spec[0]), width = Integer.parseInt(spec[1]), max = Integer.parseInt(spec[2]);
                require(rows >= 1 && rows <= 5000 && width >= 1 && width <= 5 && max >= 0 && max < width);
                Hierarchy.DefaultHierarchy hierarchy = Hierarchy.create();
                for (int i = 0; i < rows; i++) hierarchy.add(read(in, width));
                data.getDefinition().setAttributeType(names[j], hierarchy);
                data.getDefinition().setMaximumGeneralization(names[j], max);
            }
            require(in.readLine() == null);
            double before = risk(data.getHandle());
            ARXConfiguration config = ARXConfiguration.create();
            config.addPrivacyModel(new KAnonymity(k));
            config.setSuppressionLimit(0d);
            config.setQualityModel(Metric.createLossMetric());
            ARXResult result = new ARXAnonymizer().anonymize(data, config);
            if (!result.isResultAvailable()) {
                System.out.println("{\"available\":false,\"before\":" + before + "}");
                return;
            }
            DataHandle output = result.getOutput();
            require(output.getNumRows() == n);
            for (int i = 0; i < n; i++) require(!output.isOutlier(i));
            double after = risk(output);
            require(after <= 1d / k + 1e-12);
            StringBuilder levels = new StringBuilder("[");
            for (int j = 0; j < m; j++) {
                if (j > 0) levels.append(',');
                levels.append(result.getGlobalOptimum().getGeneralization(names[j]));
            }
            levels.append(']');
            System.out.println("{\"available\":true,\"before\":" + before + ",\"after\":" + after +
                               ",\"levels\":" + levels + "}");
        } catch (Exception | LinkageError e) {
            // Raw values, paths and stack traces must not become task output.
            System.out.println("{\"status\":\"HOLD\",\"code\":\"ARX_ENGINE_FAILED\"}");
            System.exit(2);
        }
    }
}
